/**
 * 065 B — Estado del crédito de IA de un negocio y aviso a su dueño.
 * El mismo umbral (20 % de lo acreditado) que usa el riesgo del Resumen: una
 * sola definición de «bajo» para el superadmin y para el propietario.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { plataformaEnabled } from "./flag";

export type EstadoCredito = "ok" | "bajo" | "agotado";
export const FRACCION_CREDITO_BAJO = 5; // saldo < acreditado / 5

export function estadoDeCredito(saldoMicros: number, acreditadoMicros: number): EstadoCredito {
  if (saldoMicros <= 0) return "agotado";
  return saldoMicros < acreditadoMicros / FRACCION_CREDITO_BAJO ? "bajo" : "ok";
}

type Db = Pick<ReturnType<typeof getDb>, "select">;

/** Total acreditado (altas y ajustes positivos): la base contra la que se mide «bajo». */
export async function acreditadoDe(organizationId: string, db: Db = getDb()): Promise<number> {
  const l = schema.aiCreditLedger;
  const [fila] = await db.select({ total: sql<number>`coalesce(sum(${l.amountMicros}), 0)`.mapWith(Number) })
    .from(l).where(and(scoped(l.organizationId, organizationId), sql`${l.kind} <> 'usage'`, sql`${l.amountMicros} > 0`));
  return fila?.total ?? 0;
}

/** Qué avisarle al propietario; null si no aplica (plataforma apagada, llave propia o saldo sano). */
export async function avisoCreditoDe(organizationId: string): Promise<{ estado: "bajo" | "agotado"; mensaje: string } | null> {
  if (!plataformaEnabled()) return null;
  const db = getDb();
  const [modo] = await db.select({ aiMode: schema.organizationPlatform.aiMode }).from(schema.organizationPlatform)
    .where(scoped(schema.organizationPlatform.organizationId, organizationId)).limit(1);
  if (modo?.aiMode !== "platform") return null;
  const [cuenta] = await db.select({ saldo: schema.aiCreditAccount.balanceMicros }).from(schema.aiCreditAccount)
    .where(eq(schema.aiCreditAccount.organizationId, organizationId)).limit(1);
  const estado = estadoDeCredito(cuenta?.saldo ?? 0, await acreditadoDe(organizationId, db));
  if (estado === "ok") return null;
  return estado === "agotado"
    ? { estado, mensaje: "Se agotó el crédito de IA: el agente dejó de contestar y las conversaciones pasan a una persona." }
    : { estado, mensaje: "Al crédito de IA le queda poco: cuando se agote, el agente dejará de contestar." };
}
