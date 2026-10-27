/**
 * 065 — Administradores globales, sin scoped(): cada operación recibe userId.
 * No se deduce ningún negocio de la sesión; la membresía es independiente.
 */
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { auditar } from "@/server/platform/audit";

export type DecisionRevocacion = { ok: true } | { ok: false; code: "last_admin" | "not_admin" };

/** La misma regla cubre quitarse a sí mismo y quitar al único administrador ajeno. */
export function decidirRevocacion(
  adminIds: readonly string[],
  actorId: string,
  targetId: string
): DecisionRevocacion {
  const admins = new Set(adminIds);
  if (!admins.has(actorId) || !admins.has(targetId)) return { ok: false, code: "not_admin" };
  if (admins.size === 1) return { ok: false, code: "last_admin" };
  return { ok: true };
}

export async function esSuperadmin(userId: string): Promise<boolean> {
  const [admin] = await getDb().select({ userId: schema.platformAdmin.userId })
    .from(schema.platformAdmin).where(eq(schema.platformAdmin.userId, userId)).limit(1);
  return !!admin;
}

export async function otorgarSuperadmin({ userId, grantedBy }: {
  userId: string;
  grantedBy: string | null;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    // Bloqueo común a altas y bajas, incluso sin filas (bootstrap). Bloquear
    // solo el destino permitiría que dos bajas dejaran cero administradores.
    await tx.execute(sql`LOCK TABLE ${schema.platformAdmin} IN SHARE ROW EXCLUSIVE MODE`);
    const creados = await tx.insert(schema.platformAdmin).values({ userId, grantedBy })
      .onConflictDoNothing().returning({ userId: schema.platformAdmin.userId });
    if (creados.length === 0) return;
    await auditar({
      actorUserId: grantedBy,
      action: "platform.admin.grant",
      organizationId: null,
      targetUserId: userId,
      detail: {},
    }, tx);
  });
}

export async function revocarSuperadmin({ userId, actorId }: {
  userId: string;
  actorId: string;
}): Promise<DecisionRevocacion> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${schema.platformAdmin} IN SHARE ROW EXCLUSIVE MODE`);
    const admins = await tx.select({ userId: schema.platformAdmin.userId }).from(schema.platformAdmin);
    const decision = decidirRevocacion(admins.map((admin) => admin.userId), actorId, userId);
    if (!decision.ok) return decision;
    await tx.delete(schema.platformAdmin).where(eq(schema.platformAdmin.userId, userId));
    await auditar({
      actorUserId: actorId,
      action: "platform.admin.revoke",
      organizationId: null,
      targetUserId: userId,
      detail: {},
    }, tx);
    return decision;
  });
}
