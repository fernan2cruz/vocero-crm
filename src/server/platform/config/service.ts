import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { auditar } from "@/server/platform/audit";
import { plataformaEnabled } from "@/server/platform/flag";
import { clavesConfig, esClaveConfig, registroConfig, respaldoConfig, type ClaveConfig } from "./registry";
import { configSync, configVencida, estadoConfig, guardadoConfig, instalarRefrescoConfig, invalidarConfig, publicarConfig, revisionConfig, type ValorGuardado } from "./cache";

/** Un fallo descarta la caché anterior: degradamos al .env, sin imprimir errores del driver. */
export async function calentarConfig(): Promise<void> {
  if (!plataformaEnabled()) return;
  const estado = estadoConfig();
  if (estado.pendiente) return estado.pendiente;
  const revision = revisionConfig();
  estado.pendiente = (async () => {
    const valores = new Map<ClaveConfig, ValorGuardado>();
    try {
      const db = getDb();
      let filas = await db.select().from(schema.platformConfig);
      if (!filas.some((f) => f.key === "META_WEBHOOK_VERIFY_TOKEN") && !respaldoConfig("META_WEBHOOK_VERIFY_TOKEN")) {
        const secreto = encryptSecret(JSON.stringify({ valor: randomBytes(32).toString("hex"), autogenerado: true }));
        // PK + DO NOTHING: dos arranques leen siempre al ganador, nunca su candidato local.
        await db.insert(schema.platformConfig).values({ key: "META_WEBHOOK_VERIFY_TOKEN",
          valueCipher: secreto.cipher, valueIv: secreto.iv, valueTag: secreto.tag }).onConflictDoNothing();
        filas = await db.select().from(schema.platformConfig);
      }
      for (const fila of filas) {
        if (!esClaveConfig(fila.key)) continue;
        const def = registroConfig[fila.key];
        const contenido = def.tipo === "secreto" ? JSON.parse(decryptSecret({ cipher: fila.valueCipher!, iv: fila.valueIv!, tag: fila.valueTag! })) as { valor: unknown; autogenerado: boolean } : null;
        const valor = contenido ? contenido.valor : JSON.parse(fila.valuePlain!);
        const parsed = def.validacion.safeParse(valor);
        if (parsed.success) valores.set(fila.key, { valor: parsed.data,
          autogenerado: fila.key === "META_WEBHOOK_VERIFY_TOKEN" && contenido?.autogenerado === true });
      }
    } catch { valores.clear(); console.error("[platform] no se pudo leer la configuración; se usa el entorno"); }
    publicarConfig(valores, revision);
  })().finally(() => { estado.pendiente = undefined; });
  return estado.pendiente;
}
instalarRefrescoConfig(calentarConfig);

export async function valorDeConfig<K extends ClaveConfig>(key: K) {
  if (plataformaEnabled() && configVencida()) await calentarConfig();
  return configSync(key);
}

export async function cambiarConfig(key: ClaveConfig, valor: unknown, actorUserId: string, quitar = false) {
  if (!plataformaEnabled()) throw new Error("Plataforma no encontrada");
  const def = registroConfig[key];
  const parsed = def.validacion.safeParse(valor);
  if (!quitar && !parsed.success) throw new Error("Valor de configuración inválido");
  try {
    await getDb().transaction(async (tx) => {
      if (quitar) await tx.delete(schema.platformConfig).where(eq(schema.platformConfig.key, key));
      else {
        const secreto = def.tipo === "secreto" ? encryptSecret(JSON.stringify({ valor: parsed.data, autogenerado: false })) : null;
        const columnas = { valueCipher: secreto?.cipher ?? null, valueIv: secreto?.iv ?? null,
          valueTag: secreto?.tag ?? null, valuePlain: secreto ? null : JSON.stringify(parsed.data),
          updatedBy: actorUserId, updatedAt: new Date() };
        await tx.insert(schema.platformConfig).values({ key, ...columnas })
          .onConflictDoUpdate({ target: schema.platformConfig.key, set: columnas });
      }
      await auditar({ actorUserId, action: quitar ? "config.clear" : "config.set", organizationId: null,
        targetUserId: null, detail: { key, secreto: def.tipo === "secreto", cambio: "cambió" } }, tx);
    });
  } catch { throw new Error("No se pudo guardar la configuración"); }
  invalidarConfig();
  // Esperar un refresco anterior y luego leer el commit, incluso si perdió su revisión.
  await estadoConfig().pendiente;
  await calentarConfig();
}

export async function listarConfig() {
  await valorDeConfig("META_WEBHOOK_VERIFY_TOKEN");
  return clavesConfig.map((key) => {
    const { etiqueta, grupo, tipo, ayuda } = registroConfig[key];
    const valor = configSync(key);
    const guardado = guardadoConfig(key);
    return { key, etiqueta, grupo, tipo, ayuda, configurado: valor !== "",
      origen: guardado ? (guardado.autogenerado ? "autogenerado" : "portal") : process.env[key] ? "env" : "default",
      ultimos4: tipo === "secreto" && valor ? String(valor).slice(-4) : null,
      valor: tipo === "secreto" ? null : valor };
  });
}
