/** 065 S7 — Protección opcional por negocio. Las lecturas de guardas degradan abiertas. */
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { businessTimezone, resolvePeriod } from "@/server/analytics/period";
import { todayInTz } from "@/lib/time/slots";
import { plataformaEnabled } from "./flag";
import { limitesSchema } from "./schemas";
import { auditar } from "./audit";
import type { z } from "zod";

export type Limites = z.infer<typeof limitesSchema>;
const SIN_LIMITES: Limites = { maxMessagesPerDay: null, maxCampaignRecipients: null, maxMonthlySpendMicros: null };
export type UsoActual = { mensajesHoy: number; gastoMesMicros: number };

export class LimiteError extends Error {
  constructor(public code: "limite_diario" | "limite_destinatarios", message: string) {
    super(message); this.name = "LimiteError";
  }
}

export function comprobarLimiteDiario(tope: number | null, usados: number): void {
  if (tope !== null && usados >= tope) throw new LimiteError("limite_diario", `Se alcanzó el límite de ${tope} mensajes por día de este negocio`);
}
export function comprobarDestinatarios(tope: number | null, cantidad: number): void {
  if (tope !== null && cantidad > tope) throw new LimiteError("limite_destinatarios", `Esta campaña tiene ${cantidad} destinatarios y el límite del negocio es ${tope}`);
}
export function alcanzoTopeMensual(tope: number | null, gasto: number): boolean {
  return tope !== null && gasto >= tope;
}

export async function limitesDe(organizationId: string): Promise<Limites> {
  if (!plataformaEnabled()) return { ...SIN_LIMITES };
  const [fila] = await getDb().select().from(schema.organizationLimits)
    .where(eq(schema.organizationLimits.organizationId, organizationId)).limit(1);
  return fila ? limitesSchema.parse({ maxMessagesPerDay: fila.maxMessagesPerDay,
    maxCampaignRecipients: fila.maxCampaignRecipients, maxMonthlySpendMicros: fila.maxMonthlySpendMicros }) : { ...SIN_LIMITES };
}

export async function fijarLimites(organizationId: string, input: Limites, actorUserId: string): Promise<boolean> {
  if (!plataformaEnabled()) return false;
  const despues = limitesSchema.parse(input);
  return getDb().transaction(async (tx) => {
    // Bloquear la organización serializa también el primer guardado, sin fila previa.
    const [org] = await tx.select({ id: schema.organization.id }).from(schema.organization)
      .where(eq(schema.organization.id, organizationId)).for("update");
    if (!org) return false;
    const [fila] = await tx.select().from(schema.organizationLimits)
      .where(eq(schema.organizationLimits.organizationId, organizationId)).limit(1);
    const antes: Limites = fila ? { maxMessagesPerDay: fila.maxMessagesPerDay,
      maxCampaignRecipients: fila.maxCampaignRecipients, maxMonthlySpendMicros: fila.maxMonthlySpendMicros } : { ...SIN_LIMITES };
    await tx.insert(schema.organizationLimits).values({ organizationId, ...despues })
      .onConflictDoUpdate({ target: schema.organizationLimits.organizationId, set: { ...despues, updatedAt: new Date() } });
    await auditar({ action: "limits.set", actorUserId, organizationId, targetUserId: null, detail: { antes, despues } }, tx);
    return true;
  });
}

async function mensajesHoyDe(organizationId: string, now: Date): Promise<number> {
  const timezone = await businessTimezone(organizationId);
  const hoy = todayInTz(now, timezone);
  const { start, end } = resolvePeriod({ from: hoy, to: hoy, timezone, now });
  const m = schema.message, c = schema.conversation;
  const [fila] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(m)
    .innerJoin(c, and(eq(c.id, m.conversationId), scoped(c.organizationId, organizationId)))
    .where(scoped(m.organizationId, organizationId, eq(m.direction, "out"), ne(m.status, "failed"),
      eq(c.isTest, false), gte(m.createdAt, start), lt(m.createdAt, end)));
  return fila?.n ?? 0;
}
async function gastoMesDe(organizationId: string, now: Date): Promise<number> {
  const inicio = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const fin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const u = schema.aiUsage;
  const [fila] = await getDb().select({ n: sql<number>`coalesce(sum(${u.costMicros}), 0)`.mapWith(Number) }).from(u)
    // Solo el agente real (`bot`): lo que gasta el Laboratorio y el juez no cuenta para el tope.
    .where(scoped(u.organizationId, organizationId, eq(u.source, "bot"), gte(u.createdAt, inicio), lt(u.createdAt, fin)));
  return fila?.n ?? 0;
}
export async function usoActualDe(organizationId: string, now = new Date()): Promise<UsoActual> {
  if (!plataformaEnabled()) return { mensajesHoy: 0, gastoMesMicros: 0 };
  const [mensajesHoy, gastoMesMicros] = await Promise.all([mensajesHoyDe(organizationId, now), gastoMesDe(organizationId, now)]);
  return { mensajesHoy, gastoMesMicros };
}

export async function verificarLimiteDiario(organizationId: string, isTest = false, now = new Date()): Promise<void> {
  if (!plataformaEnabled() || isTest) return;
  let tope: number | null, usados: number;
  try {
    tope = (await limitesDe(organizationId)).maxMessagesPerDay;
    if (tope === null) return;
    usados = await mensajesHoyDe(organizationId, now);
  } catch { console.error("[platform] No se pudo leer el límite diario"); return; }
  comprobarLimiteDiario(tope, usados);
}
export async function verificarDestinatarios(organizationId: string, cantidad: number): Promise<void> {
  if (!plataformaEnabled()) return;
  let tope: number | null;
  try { tope = (await limitesDe(organizationId)).maxCampaignRecipients; }
  catch { console.error("[platform] No se pudo leer el límite de destinatarios"); return; }
  comprobarDestinatarios(tope, cantidad);
}
/** El llamador ya resolvió el modo: con llave propia no se consulta este límite. */
export async function topeMensualAlcanzado(organizationId: string, now = new Date()): Promise<boolean> {
  if (!plataformaEnabled()) return false;
  try {
    const tope = (await limitesDe(organizationId)).maxMonthlySpendMicros;
    return tope !== null && alcanzoTopeMensual(tope, await gastoMesDe(organizationId, now));
  } catch { console.error("[platform] No se pudo leer el tope mensual de IA"); return false; }
}
