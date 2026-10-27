/** Agregados globales autorizados por plataforma. Días UTC, sin zona única. */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { diasDelPeriodo, type Periodo } from "./periodo";

const u = schema.aiUsage;
function rango(p: Periodo, organizationId?: string) {
  return and(gte(u.createdAt, p.desde), lt(u.createdAt, p.hasta), organizationId === undefined ? undefined : eq(u.organizationId, organizationId));
}
const totales = () => ({ llamadas: sql<number>`count(*)`.mapWith(Number),
  tokensEntrada: sql<number>`coalesce(sum(${u.promptTokens}), 0)`.mapWith(Number),
  tokensSalida: sql<number>`coalesce(sum(${u.completionTokens}), 0)`.mapWith(Number),
  costoMicros: sql<number>`coalesce(sum(${u.costMicros}), 0)`.mapWith(Number) });

export async function consumoPorNegocio(periodo: Periodo) {
  const db = getDb();
  const [negocios, consumo] = await Promise.all([
    db.select({ organizationId: schema.organization.id, nombre: schema.organization.name,
      aiMode: sql<"platform" | "own_key">`coalesce(${schema.organizationPlatform.aiMode}, 'own_key')`,
      saldo: schema.aiCreditAccount.balanceMicros }).from(schema.organization)
      .leftJoin(schema.organizationPlatform, eq(schema.organizationPlatform.organizationId, schema.organization.id))
      .leftJoin(schema.aiCreditAccount, eq(schema.aiCreditAccount.organizationId, schema.organization.id)),
    db.select({ organizationId: u.organizationId, source: u.source, ...totales() }).from(u)
      .where(rango(periodo)).groupBy(u.organizationId, u.source),
  ]);
  const acumulados = new Map<string, { llamadas: number; tokensEntrada: number; tokensSalida: number; costoMicros: number;
    porFuente: Record<"bot" | "lab" | "judge", { llamadas: number; costoMicros: number }> }>();
  for (const r of consumo) {
    const a = acumulados.get(r.organizationId) ?? { llamadas: 0, tokensEntrada: 0, tokensSalida: 0, costoMicros: 0,
      porFuente: { bot: { llamadas: 0, costoMicros: 0 }, lab: { llamadas: 0, costoMicros: 0 }, judge: { llamadas: 0, costoMicros: 0 } } };
    a.llamadas += r.llamadas; a.tokensEntrada += r.tokensEntrada; a.tokensSalida += r.tokensSalida; a.costoMicros += r.costoMicros;
    a.porFuente[r.source] = { llamadas: r.llamadas, costoMicros: r.costoMicros };
    acumulados.set(r.organizationId, a);
  }
  return negocios.map(({ saldo, ...n }) => ({ ...n,
    ...(acumulados.get(n.organizationId) ?? { llamadas: 0, tokensEntrada: 0, tokensSalida: 0, costoMicros: 0,
      porFuente: { bot: { llamadas: 0, costoMicros: 0 }, lab: { llamadas: 0, costoMicros: 0 }, judge: { llamadas: 0, costoMicros: 0 } } }),
    saldoMicros: n.aiMode === "platform" ? saldo ?? 0 : null,
  })).sort((a, b) => b.costoMicros - a.costoMicros || a.organizationId.localeCompare(b.organizationId));
}
export async function consumoPorModelo(periodo: Periodo, organizationId?: string) {
  return getDb().select({ model: u.model, ...totales() }).from(u).where(rango(periodo, organizationId)).groupBy(u.model)
    .orderBy(sql`sum(${u.costMicros}) desc`, u.model);
}
export async function serieDiaria(periodo: Periodo, organizationId?: string) {
  // Los timestamp del esquema ya representan UTC; no se convierten a hora local.
  const filas = await getDb().select({ dia: sql<string>`to_char(${u.createdAt}, 'YYYY-MM-DD')`,
    llamadas: totales().llamadas, costoMicros: totales().costoMicros }).from(u).where(rango(periodo, organizationId)).groupBy(sql`1`);
  const porDia = new Map(filas.map((r) => [r.dia, r]));
  return diasDelPeriodo(periodo).map((dia) => porDia.get(dia) ?? { dia, llamadas: 0, costoMicros: 0 });
}
