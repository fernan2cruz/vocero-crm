/** Resumen UTC: periodo global; el estado operativo y el crédito son actuales. */
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { botLastSeenAt } from "@/server/bot/status";
import { consumoPorNegocio } from "./consumo";
import type { Periodo } from "./periodo";
import { motivosDeRiesgo } from "./riesgo";

export async function resumenPlataforma(periodo: Periodo) {
  const db = getDb();
  const [consumo, estados, usuarios, creditos, agotados, saldos] = await Promise.all([
    consumoPorNegocio(periodo),
    db.select({ organizationId: schema.organization.id, status: schema.organizationPlatform.status,
      enabled: schema.agentProfile.enabled }).from(schema.organization)
      .leftJoin(schema.organizationPlatform, eq(schema.organizationPlatform.organizationId, schema.organization.id))
      .leftJoin(schema.agentProfile, eq(schema.agentProfile.organizationId, schema.organization.id)),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(schema.user),
    db.select({ organizationId: schema.aiCreditLedger.organizationId,
      total: sql<number>`coalesce(sum(${schema.aiCreditLedger.amountMicros}) filter (where ${schema.aiCreditLedger.kind} in ('grant', 'adjust') and ${schema.aiCreditLedger.amountMicros} > 0), 0)`.mapWith(Number),
    }).from(schema.aiCreditLedger).groupBy(schema.aiCreditLedger.organizationId),
    // health.ts → conteoGlobal considera agotado exactamente status='agotado'.
    // El esquema tiene organization_id: no hace falta atribuir el total global.
    db.select({ organizationId: schema.webhookEvent.organizationId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.webhookEvent).where(eq(schema.webhookEvent.status, "agotado")).groupBy(schema.webhookEvent.organizationId),
    // El crédito asignado sigue existiendo aunque el negocio cambie a llave propia.
    db.select({ organizationId: schema.aiCreditAccount.organizationId, saldo: schema.aiCreditAccount.balanceMicros })
      .from(schema.aiCreditAccount),
  ]);
  const porEstado = new Map(estados.map((r) => [r.organizationId, r]));
  const porCredito = new Map(creditos.map((r) => [r.organizationId, r.total]));
  const porWebhook = new Map(agotados.map((r) => [r.organizationId, r.n]));
  const ahora = new Date();
  const enRiesgo = consumo.flatMap((r) => {
    const estado = porEstado.get(r.organizationId);
    const motivos = motivosDeRiesgo({ aiMode: r.aiMode, saldoMicros: r.saldoMicros ?? 0,
      acreditadoMicros: porCredito.get(r.organizationId) ?? 0, agenteEncendido: estado?.enabled ?? false,
      webhooksAgotados: porWebhook.get(r.organizationId) ?? 0, suspendido: estado?.status === "suspended",
      // Solo memoria del proceso: la señal se pierde al reiniciar y no consulta /health.
      ultimaSenal: botLastSeenAt(r.organizationId), ahora });
    return motivos.length ? [{ organizationId: r.organizationId, nombre: r.nombre, motivos }] : [];
  });
  const suspendidos = estados.filter((r) => r.status === "suspended").length;
  return { negocios: { activos: estados.length - suspendidos, suspendidos }, usuarios: usuarios[0]?.n ?? 0,
    consumo: { costoMicros: consumo.reduce((n, r) => n + r.costoMicros, 0), llamadas: consumo.reduce((n, r) => n + r.llamadas, 0) },
    creditoTotalMicros: saldos.reduce((n, r) => n + r.saldo, 0),
    topConsumo: consumo.slice(0, 5).map(({ organizationId, nombre, costoMicros }) => ({ organizationId, nombre, costoMicros })), enRiesgo };
}
