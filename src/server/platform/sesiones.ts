/** Metadatos globales de sesiones: la proyección excluye el token desde SQL. */
import { and, desc, eq, gt, inArray, ne, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { auditar } from "./audit";
import { plataformaEnabled } from "./flag";
import { sesionesSchema } from "./schemas";

export async function listarSesiones(input: { organizationId?: string; userId?: string; limit?: number } = {}) {
  if (!plataformaEnabled()) return [];
  const { organizationId, userId, limit } = sesionesSchema.parse(input);
  const t = schema.session;
  return getDb().select({ id: t.id, userId: t.userId, userName: schema.user.name, email: schema.user.email,
    organizationId: t.activeOrganizationId, organizationName: schema.organization.name,
    ip: t.ipAddress, userAgent: t.userAgent, createdAt: t.createdAt, expiresAt: t.expiresAt }).from(t)
    .innerJoin(schema.user, eq(schema.user.id, t.userId))
    .leftJoin(schema.organization, eq(schema.organization.id, t.activeOrganizationId))
    .where(and(gt(t.expiresAt, new Date()), userId ? eq(t.userId, userId) : undefined,
      organizationId ? eq(t.activeOrganizationId, organizationId) : undefined))
    .orderBy(desc(t.createdAt), desc(t.id)).limit(limit);
}

type Actor = { userId: string };
async function cerrar(scope: "session" | "user" | "org", id: string, actor: Actor) {
  if (!plataformaEnabled()) return 0;
  return getDb().transaction(async (tx) => {
    const t = schema.session;
    let filtro: SQL = scope === "session" ? eq(t.id, id) : scope === "user" ? eq(t.userId, id)
      : inArray(t.userId, tx.select({ userId: schema.member.userId }).from(schema.member)
        .where(eq(schema.member.organizationId, id)));
    if (scope !== "session") {
      const [admin] = await tx.select({ id: schema.platformAdmin.userId }).from(schema.platformAdmin)
        .where(eq(schema.platformAdmin.userId, actor.userId));
      // La emergencia masiva no debe expulsar a quien está resolviéndola.
      if (admin) filtro = and(filtro, ne(t.userId, actor.userId))!;
    }
    const filas = await tx.delete(t).where(filtro).returning({ id: t.id, userId: t.userId, organizationId: t.activeOrganizationId });
    await auditar({ actorUserId: actor.userId, action: "session.revoke",
      organizationId: scope === "org" ? id : scope === "session" ? filas[0]?.organizationId ?? null : null,
      targetUserId: scope === "user" ? id : scope === "session" ? filas[0]?.userId ?? null : null,
      detail: { scope, n: filas.length } }, tx);
    return filas.length;
  });
}
export function cerrarSesion(sessionId: string, actor: Actor) { return cerrar("session", sessionId, actor); }
export function cerrarSesionesDeUsuario(userId: string, actor: Actor) { return cerrar("user", userId, actor); }
export function cerrarSesionesDeNegocio(organizationId: string, actor: Actor) { return cerrar("org", organizationId, actor); }
