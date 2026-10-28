import { and, asc, eq, or, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { newId } from "@/lib/db/ids";
import { getDb, schema } from "@/lib/db";
import { normalizeText } from "@/lib/search";
import { auditar } from "@/server/platform/audit";
import { generarContrasenaTemporal } from "@/server/platform/password";
import { crearUsuarioSchema, listarUsuariosSchema, motivoSchema } from "@/server/platform/schemas";
import type { z } from "zod";

/** Alta atómica sin abrir el registro público ni crear sesiones o negocios. */
export async function crearUsuario(input: z.input<typeof crearUsuarioSchema> & { actorUserId: string }) {
  const { actorUserId, ...cuerpo } = input;
  const datos = crearUsuarioSchema.parse(cuerpo);
  const contrasenaTemporal = datos.tempPassword ?? generarContrasenaTemporal();
  const password = await hashPassword(contrasenaTemporal);
  return getDb().transaction(async (tx) => {
    const [negocio] = await tx.select({ id: schema.organization.id }).from(schema.organization)
      .where(eq(schema.organization.id, datos.organizationId)).for("share");
    if (!negocio) return { ok: false as const, code: "not_found" as const };
    const [existente] = await tx.select({ id: schema.user.id }).from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${datos.email}`).limit(1);
    if (existente) return { ok: false as const, code: "email_taken" as const };
    const userId = randomUUID();
    const [usuario] = await tx.insert(schema.user).values({ id: userId, name: datos.name, email: datos.email })
      .onConflictDoNothing({ target: schema.user.email }).returning({ id: schema.user.id });
    if (!usuario) return { ok: false as const, code: "email_taken" as const };
    // Mismo formato de credencial y hash que Better Auth y el reinicio de contraseña.
    await tx.insert(schema.account).values({ id: randomUUID(), userId, accountId: userId,
      providerId: "credential", password });
    await tx.insert(schema.member).values({ id: newId("member"), userId,
      organizationId: datos.organizationId, role: datos.role });
    await auditar({ actorUserId, action: "user.create", organizationId: datos.organizationId,
      targetUserId: userId, detail: { name: datos.name, email: datos.email, role: datos.role } }, tx);
    return { ok: true as const, usuario: { id: userId, name: datos.name, email: datos.email,
      organizationId: datos.organizationId, role: datos.role }, contrasenaTemporal };
  });
}

export { generarContrasenaTemporal } from "@/server/platform/password";
export { usuarioDesactivado } from "@/server/platform/estado";

export function decidirDesactivacion(input: {
  targetEsSuperadmin: boolean; actorId: string; targetId: string;
}): { ok: true } | { ok: false; code: "is_superadmin" | "self" } {
  if (input.targetEsSuperadmin) return { ok: false, code: "is_superadmin" };
  if (input.actorId === input.targetId) return { ok: false, code: "self" };
  return { ok: true };
}

/** Solo metadatos: nunca se selecciona una cuenta ni un token de sesión. */
export async function listarUsuarios(input: { q?: string; organizationId?: string } = {}) {
  const { q, organizationId } = listarUsuariosSchema.parse(input);
  const db = getDb();
  const sesiones = db.select({ userId: schema.session.userId,
    ultimaSesion: sql<Date | null>`max(${schema.session.createdAt})`.mapWith(schema.session.createdAt).as("ultima_sesion"),
  }).from(schema.session).groupBy(schema.session.userId).as("sesiones");
  const desde = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
  const hasta = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";
  const patron = `%${normalizeText(q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
  return db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email,
    createdAt: schema.user.createdAt, organizationId: schema.member.organizationId,
    organizationName: schema.organization.name, role: schema.member.role,
    disabled: sql<boolean>`${schema.userPlatform.userId} is not null`,
    esSuperadmin: sql<boolean>`${schema.platformAdmin.userId} is not null`,
    ultimaSesion: sesiones.ultimaSesion,
  }).from(schema.user)
    .leftJoin(schema.member, eq(schema.member.userId, schema.user.id))
    .leftJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .leftJoin(schema.userPlatform, eq(schema.userPlatform.userId, schema.user.id))
    .leftJoin(schema.platformAdmin, eq(schema.platformAdmin.userId, schema.user.id))
    .leftJoin(sesiones, eq(sesiones.userId, schema.user.id))
    .where(and(organizationId ? eq(schema.member.organizationId, organizationId) : undefined,
      q ? or(sql`lower(translate(${schema.user.name}, ${desde}, ${hasta})) like ${patron}`,
        sql`lower(translate(${schema.user.email}, ${desde}, ${hasta})) like ${patron}`) : undefined))
    .orderBy(asc(schema.user.name), asc(schema.user.id)).limit(200);
}

export async function desactivarUsuario(input: { userId: string; reason: string; actorUserId: string }) {
  const reason = motivoSchema.parse(input.reason);
  return getDb().transaction(async (tx) => {
    // El mismo bloqueo que las altas de superadmin cierra la carrera alta/desactivación.
    await tx.execute(sql`LOCK TABLE ${schema.platformAdmin} IN SHARE ROW EXCLUSIVE MODE`);
    const [usuario] = await tx.select({ id: schema.user.id }).from(schema.user)
      .where(eq(schema.user.id, input.userId)).for("update");
    if (!usuario) return { ok: false as const, code: "not_found" as const };
    const [admin] = await tx.select({ id: schema.platformAdmin.userId }).from(schema.platformAdmin)
      .where(eq(schema.platformAdmin.userId, input.userId));
    const decision = decidirDesactivacion({ targetEsSuperadmin: !!admin,
      actorId: input.actorUserId, targetId: input.userId });
    if (!decision.ok) return decision;
    await tx.insert(schema.userPlatform).values({ userId: input.userId, disabledReason: reason,
      disabledBy: input.actorUserId }).onConflictDoUpdate({ target: schema.userPlatform.userId,
      set: { disabledAt: new Date(), disabledReason: reason, disabledBy: input.actorUserId } });
    await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    await auditar({ actorUserId: input.actorUserId, action: "user.disable", organizationId: null,
      targetUserId: input.userId, detail: { reason } }, tx);
    return { ok: true as const };
  });
}

export async function reactivarUsuario(input: { userId: string; actorUserId: string }) {
  return getDb().transaction(async (tx) => {
    const [usuario] = await tx.select({ id: schema.user.id }).from(schema.user)
      .where(eq(schema.user.id, input.userId)).for("update");
    if (!usuario) return { ok: false as const, code: "not_found" as const };
    await tx.delete(schema.userPlatform).where(eq(schema.userPlatform.userId, input.userId));
    await auditar({ actorUserId: input.actorUserId, action: "user.enable", organizationId: null,
      targetUserId: input.userId, detail: {} }, tx);
    return { ok: true as const };
  });
}

export async function reiniciarContrasena(input: { userId: string; actorUserId: string }) {
  const contrasenaTemporal = generarContrasenaTemporal();
  const password = await hashPassword(contrasenaTemporal);
  return getDb().transaction(async (tx) => {
    const [usuario] = await tx.select({ id: schema.user.id }).from(schema.user)
      .where(eq(schema.user.id, input.userId)).for("update");
    if (!usuario) return { ok: false as const, code: "not_found" as const };
    // A un superadmin NO se le reinicia la contraseña desde el portal: una cuenta
    // de plataforma comprometida podría tomar la de otra en silencio. Cada
    // superadmin cambia la suya por su propio camino.
    const [esAdmin] = await tx.select({ id: schema.platformAdmin.userId }).from(schema.platformAdmin)
      .where(eq(schema.platformAdmin.userId, input.userId));
    if (esAdmin) return { ok: false as const, code: "is_superadmin" as const };
    const cuentas = await tx.update(schema.account).set({ password, updatedAt: new Date() })
      .where(and(eq(schema.account.userId, input.userId), eq(schema.account.providerId, "credential")))
      .returning({ id: schema.account.id });
    if (!cuentas.length) return { ok: false as const, code: "no_credential" as const };
    await tx.delete(schema.session).where(eq(schema.session.userId, input.userId));
    await auditar({ actorUserId: input.actorUserId, action: "user.password_reset", organizationId: null,
      targetUserId: input.userId, detail: {} }, tx);
    return { ok: true as const, contrasenaTemporal };
  });
}
