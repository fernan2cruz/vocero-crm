import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { last4, type AiProviderId } from "@/lib/ai/presets";
import type { AiProvider } from "@/lib/ai/provider";
import { plataformaEnabled } from "@/server/platform/flag";
import { moverSaldo } from "@/server/platform/credit";
import { auditar } from "@/server/platform/audit";
import { acreditadoDe, estadoDeCredito } from "@/server/platform/credito-estado";
import { precioIaSchema } from "@/server/platform/schemas";

const tokens = z.number().int().min(0).max(2_147_483_647);
const costo = z.number().finite().nonnegative();
const respuestaSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  usage: z.object({ prompt_tokens: tokens, completion_tokens: tokens, cost: costo.optional() }),
});
export type UsoIa = { promptTokens: number; completionTokens: number; costoUsd?: number; modelo?: string };
type Precio = Pick<typeof schema.aiModelPrice.$inferSelect, "inputPerMillionMicros" | "outputPerMillionMicros">;

export function costoDeUso(input: { promptTokens: number; completionTokens: number; costoReportadoUsd?: number; precio?: Precio | null }): number {
  tokens.parse(input.promptTokens);
  tokens.parse(input.completionTokens);
  let resultado: number;
  if (input.costoReportadoUsd !== undefined) {
    resultado = Math.round(costo.parse(input.costoReportadoUsd) * 1_000_000);
  } else if (input.precio) {
    const precio = precioIaSchema.parse({ model: "precio",
      inputPerMillionMicros: input.precio.inputPerMillionMicros,
      outputPerMillionMicros: input.precio.outputPerMillionMicros });
    // BigInt evita perder micros en el producto intermedio y redondea una sola vez.
    const numerador = BigInt(input.promptTokens) * BigInt(precio.inputPerMillionMicros)
      + BigInt(input.completionTokens) * BigInt(precio.outputPerMillionMicros);
    resultado = Number((numerador + 500_000n) / 1_000_000n);
  } else resultado = 0;
  if (!Number.isSafeInteger(resultado) || resultado < 0) throw new Error("Costo fuera de rango seguro");
  return resultado;
}

/** JSON y SSE ajenos se validan sin propagar errores ni conservar mensajes. */
export function extraerUso(cuerpo: unknown, contentType: string): UsoIa | null {
  try {
    const candidatos: unknown[] = [];
    if (typeof cuerpo !== "string") candidatos.push(cuerpo);
    else if (/text\/event-stream/i.test(contentType)) {
      for (const evento of cuerpo.replace(/\r\n/g, "\n").split(/\n\n/)) {
        const datos = evento.split("\n").filter((linea) => linea.startsWith("data:"))
          .map((linea) => linea.slice(5).trimStart()).join("\n");
        try { candidatos.push(JSON.parse(datos)); } catch {
          // Algunos compatibles emiten una línea por frame sin separador vacío.
          for (const linea of evento.split("\n")) {
            if (!linea.startsWith("data:")) continue;
            try { candidatos.push(JSON.parse(linea.slice(5))); } catch { /* Ignorar basura y [DONE]. */ }
          }
        }
      }
    } else candidatos.push(JSON.parse(cuerpo));
    let ultimo: UsoIa | null = null;
    for (const candidato of candidatos) {
      const r = respuestaSchema.safeParse(candidato);
      if (r.success) ultimo = { promptTokens: r.data.usage.prompt_tokens,
        completionTokens: r.data.usage.completion_tokens,
        ...(r.data.usage.cost === undefined ? {} : { costoUsd: r.data.usage.cost }),
        ...(r.data.model === undefined ? {} : { modelo: r.data.model }) };
    }
    return ultimo;
  } catch { return null; }
}

/** Fuera de la transacción del cobro: una alerta que falle jamás deshace un consumo ya cobrado. */
async function alertarCredito(organizationId: string, saldoDespues: number, costMicros: number): Promise<void> {
  try {
    const acreditado = await acreditadoDe(organizationId);
    const antes = estadoDeCredito(saldoDespues + costMicros, acreditado);
    const despues = estadoDeCredito(saldoDespues, acreditado);
    // Una sola alerta por cruce: el saldo se mueve bajo bloqueo de fila, solo un cobro cruza.
    if (antes === despues || despues === "ok") return;
    await auditar({ actorUserId: null, action: despues === "agotado" ? "credit.depleted" : "credit.low",
      organizationId, targetUserId: null, detail: { balanceAfter: saldoDespues } });
  } catch {
    console.error("[platform] No se pudo registrar la alerta de crédito");
  }
}

export async function registrarUso(input: { organizationId: string; source: "bot" | "lab" | "judge"; model: string; uso: UsoIa; cobrar: boolean }): Promise<void> {
  if (!plataformaEnabled()) return;
  try {
    const db = getDb();
    const modelo = input.uso.modelo ?? input.model;
    const [precio] = input.uso.costoUsd === undefined
      ? await db.select().from(schema.aiModelPrice).where(eq(schema.aiModelPrice.model, modelo)).limit(1) : [];
    const costMicros = costoDeUso({ ...input.uso, costoReportadoUsd: input.uso.costoUsd, precio });
    let saldoDespues: number | null = null;
    await db.transaction(async (tx) => {
      const id = newId("aiUsage");
      if (input.cobrar && costMicros > 0) {
        // El último consumo puede dejar saldo negativo; el siguiente prechequeo corta.
        const balanceAfter = await moverSaldo(tx, input.organizationId, -costMicros);
        await tx.insert(schema.aiCreditLedger).values({ id: newId("aiCreditLedger"),
          organizationId: input.organizationId, kind: "usage", amountMicros: -costMicros,
          balanceAfter, ref: id });
        saldoDespues = balanceAfter;
      }
      await tx.insert(schema.aiUsage).values({ id, organizationId: input.organizationId,
        source: input.source, model: modelo, promptTokens: input.uso.promptTokens,
        completionTokens: input.uso.completionTokens, costMicros });
    });
    if (saldoDespues !== null) await alertarCredito(input.organizationId, saldoDespues, costMicros);
  } catch {
    // No incluir el error del driver: puede contener SQL, valores o secretos.
    console.error("[platform] No se pudo registrar el consumo de IA");
  }
}

export function preciosDeIa() {
  return getDb().select().from(schema.aiModelPrice).orderBy(asc(schema.aiModelPrice.model));
}
export async function guardarPrecioIa(input: z.infer<typeof precioIaSchema>, actorUserId: string) {
  const datos = precioIaSchema.parse(input);
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.aiModelPrice).values(datos).onConflictDoUpdate({ target: schema.aiModelPrice.model,
      set: { ...datos, updatedAt: new Date() } });
    await auditar({ actorUserId, action: "ai.price", organizationId: null, targetUserId: null, detail: datos }, tx);
  });
}

// El acceso global a configuración de IA queda en server/platform (S-6).
export async function modoIaDe(organizationId: string): Promise<"own_key" | "platform"> {
  const [fila] = await getDb().select({ aiMode: schema.organizationPlatform.aiMode }).from(schema.organizationPlatform)
    .where(scoped(schema.organizationPlatform.organizationId, organizationId)).limit(1);
  return fila?.aiMode ?? "own_key";
}

async function filaPlataforma() {
  const [fila] = await getDb().select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 1)).limit(1);
  return fila ?? null;
}

export async function proveedorPlataforma(): Promise<AiProvider | null> {
  const fila = await filaPlataforma();
  if (!fila?.tokenCipher || !fila.tokenIv || !fila.tokenTag || !fila.aiBaseUrl || !fila.aiModel) return null;
  return { source: "platform", baseUrl: fila.aiBaseUrl, model: fila.aiModel, judgeModel: fila.aiModel,
    token: decryptSecret({ cipher: fila.tokenCipher, iv: fila.tokenIv, tag: fila.tokenTag }) };
}

export async function ajustesIaPlataforma() {
  const fila = await filaPlataforma();
  return { provider: fila?.aiProvider ?? null, baseUrl: fila?.aiBaseUrl ?? null,
    model: fila?.aiModel ?? null, last4: fila?.tokenLast4 ?? null,
    configurada: !!(fila?.tokenCipher && fila.tokenIv && fila.tokenTag && fila.aiBaseUrl && fila.aiModel) };
}

export async function guardarIaPlataforma(input: { provider: AiProviderId; baseUrl: string; model: string; token?: string }, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const config = { aiProvider: input.provider, aiBaseUrl: input.baseUrl, aiModel: input.model, updatedAt: new Date() };
    let tokenLast4: string | null;
    if (input.token !== undefined) {
      const secreto = encryptSecret(input.token);
      tokenLast4 = last4(input.token);
      const valores = { ...config, tokenCipher: secreto.cipher, tokenIv: secreto.iv, tokenTag: secreto.tag, tokenLast4 };
      await tx.insert(schema.platformSettings).values({ id: 1, ...valores })
        .onConflictDoUpdate({ target: schema.platformSettings.id, set: valores });
    } else {
      const [fila] = await tx.update(schema.platformSettings).set(config).where(eq(schema.platformSettings.id, 1))
        .returning({ tokenLast4: schema.platformSettings.tokenLast4 });
      if (!fila?.tokenLast4) return false;
      tokenLast4 = fila.tokenLast4;
    }
    await auditar({ actorUserId, action: "ai_key.set", organizationId: null, targetUserId: null,
      detail: { scope: "platform", last4: tokenLast4 } }, tx);
    return true;
  });
}

export async function cambiarModoIa(input: { organizationId: string; aiMode: "own_key" | "platform"; actorUserId: string }) {
  return getDb().transaction(async (tx) => {
    const [negocio] = await tx.select({ id: schema.organization.id }).from(schema.organization)
      .where(eq(schema.organization.id, input.organizationId)).for("update");
    if (!negocio) return "not_found" as const;
    if (input.aiMode === "platform" && !(await ajustesIaPlataforma()).configurada) return "platform_key_missing" as const;
    await tx.insert(schema.organizationPlatform).values({ organizationId: input.organizationId, aiMode: input.aiMode })
      .onConflictDoUpdate({ target: schema.organizationPlatform.organizationId, set: { aiMode: input.aiMode } });
    await auditar({ actorUserId: input.actorUserId, action: "ai.mode", organizationId: input.organizationId,
      targetUserId: null, detail: { aiMode: input.aiMode } }, tx);
    return "ok" as const;
  });
}
