/** Lectura global de la bitácora append-only, sin ampliar el alcance de withAuth. */
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { plataformaEnabled } from "./flag";
import { auditoriaSchema } from "./schemas";

type Filtros = { desde: Date; hasta: Date; organizationId?: string; actorUserId?: string;
  accion?: string; limit?: number; antes?: string };
export async function buscarAuditoria(input: Filtros) {
  if (!plataformaEnabled()) return [];
  const { organizationId, actorUserId, accion, limit, antes } = auditoriaSchema.parse({
    organizationId: input.organizationId, actorUserId: input.actorUserId,
    accion: input.accion, limit: input.limit, antes: input.antes,
  });
  const t = schema.platformAudit;
  const actor = alias(schema.user, "actor");
  const destino = alias(schema.user, "destino");
  // JS conserva milisegundos; ordenar y filtrar con esa misma precisión evita
  // saltarse filas cuando Postgres guardó microsegundos en el mismo instante.
  const fecha = sql`date_trunc('milliseconds', ${t.createdAt})`;
  return getDb().select({ id: t.id, actorUserId: t.actorUserId, actorName: actor.name, actorEmail: actor.email,
    targetUserId: t.targetUserId, targetName: destino.name, targetEmail: destino.email,
    organizationId: t.organizationId, organizationName: schema.organization.name,
    action: t.action, detail: t.detail, createdAt: t.createdAt }).from(t)
    .leftJoin(actor, eq(actor.id, t.actorUserId)).leftJoin(destino, eq(destino.id, t.targetUserId))
    .leftJoin(schema.organization, eq(schema.organization.id, t.organizationId))
    .where(and(gte(t.createdAt, input.desde), lt(t.createdAt, input.hasta),
      organizationId ? eq(t.organizationId, organizationId) : undefined,
      actorUserId ? eq(t.actorUserId, actorUserId) : undefined, accion ? eq(t.action, accion) : undefined,
      antes ? or(sql`${fecha} < ${antes.createdAt.toISOString()}::timestamp`,
        and(sql`${fecha} = ${antes.createdAt.toISOString()}::timestamp`, lt(t.id, antes.id))) : undefined))
    .orderBy(desc(fecha), desc(t.id)).limit(limit);
}

export async function exportarAuditoriaCsv(input: Filtros) {
  const filas = await buscarAuditoria(input);
  return toCsv(["ID", "Fecha UTC", "Actor", "Correo del actor", "Acción", "Destino", "Correo del destino", "Negocio", "Detalle"],
    filas.map((r) => [r.id, r.createdAt.toISOString(), r.actorName, r.actorEmail, r.action,
      r.targetName, r.targetEmail, r.organizationName, JSON.stringify(r.detail)]));
}
