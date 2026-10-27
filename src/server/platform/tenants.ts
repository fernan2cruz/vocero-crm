import { asc, eq, inArray, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { getDb, schema } from "@/lib/db";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { sembrarNegocio } from "@/server/auth/on-signup";
import { auditar } from "@/server/platform/audit";
import { generarContrasenaTemporal } from "@/server/platform/password";
import { crearNegocioSchema, motivoSchema, notasNegocioSchema } from "@/server/platform/schemas";
export { estadoDeNegocio } from "@/server/platform/estado";

function consultaNegocios() {
  const db = getDb();
  const miembros = db.select({ organizationId: schema.member.organizationId,
    n: sql<number>`count(*)::int`.as("n"),
  }).from(schema.member).groupBy(schema.member.organizationId).as("miembros");
  return db.select({ id: schema.organization.id, name: schema.organization.name,
    slug: schema.organization.slug, createdAt: schema.organization.createdAt,
    status: sql<"active" | "suspended">`coalesce(${schema.organizationPlatform.status}, 'active')`,
    aiMode: sql<"own_key" | "platform">`coalesce(${schema.organizationPlatform.aiMode}, 'own_key')`,
    suspendedAt: schema.organizationPlatform.suspendedAt,
    suspendedReason: schema.organizationPlatform.suspendedReason,
    usuarios: sql<number>`coalesce(${miembros.n}, 0)::int`,
    agenteEncendido: sql<boolean>`coalesce(${schema.agentProfile.enabled}, false)`,
    notes: schema.organizationPlatform.notes,
  }).from(schema.organization)
    .leftJoin(schema.organizationPlatform, eq(schema.organizationPlatform.organizationId, schema.organization.id))
    .leftJoin(schema.agentProfile, eq(schema.agentProfile.organizationId, schema.organization.id))
    .leftJoin(miembros, eq(miembros.organizationId, schema.organization.id));
}

export async function listarNegocios() {
  const filas = await consultaNegocios().orderBy(asc(schema.organization.name));
  return filas.map(({ notes: _notes, ...negocio }) => negocio);
}

export async function obtenerNegocio(id: string) {
  const [negocio] = await consultaNegocios().where(eq(schema.organization.id, id)).limit(1);
  if (!negocio) return null;
  const usuarios = await getDb().select({ userId: schema.user.id, name: schema.user.name,
    email: schema.user.email, role: schema.member.role,
    disabled: sql<boolean>`${schema.userPlatform.userId} is not null`,
  }).from(schema.member).innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .leftJoin(schema.userPlatform, eq(schema.userPlatform.userId, schema.user.id))
    .where(eq(schema.member.organizationId, id)).orderBy(asc(schema.user.name));
  return { ...negocio, usuarios };
}

export async function crearNegocio(input: {
  name: string; ownerName: string; ownerEmail: string; tempPassword?: string; actorUserId: string;
}) {
  const datos = crearNegocioSchema.parse({ name: input.name, ownerName: input.ownerName,
    ownerEmail: input.ownerEmail, tempPassword: input.tempPassword });
  const db = getDb();
  const [existente] = await db.select({ id: schema.user.id }).from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${datos.ownerEmail}`).limit(1);
  if (existente) return { ok: false as const, code: "email_taken" as const };
  const contrasenaTemporal = datos.tempPassword ?? generarContrasenaTemporal();
  let userId: string;
  try {
    const resultado = await runInternalSignup(() => getAuth().api.signUpEmail({
      body: { name: datos.ownerName, email: datos.ownerEmail, password: contrasenaTemporal },
    }));
    userId = resultado.user.id;
  } catch (error) {
    if (error instanceof APIError && error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      return { ok: false as const, code: "email_taken" as const };
    }
    // No propagar errores del proveedor de auth: pueden incluir el cuerpo del alta.
    throw new Error("No se pudo crear la cuenta del propietario");
  }
  let organizationId: string;
  try {
    organizationId = await db.transaction(async (tx) => {
      const id = await sembrarNegocio(tx, { name: datos.name, ownerUserId: userId });
      await tx.insert(schema.organizationPlatform).values({ organizationId: id, status: "active", aiMode: "own_key" });
      // El registro interno puede abrir sesión antes de tener membresía; no se entrega.
      await tx.delete(schema.session).where(eq(schema.session.userId, userId));
      await auditar({ actorUserId: input.actorUserId, action: "org.create", organizationId: id,
        targetUserId: userId, detail: { name: datos.name, ownerEmail: datos.ownerEmail } }, tx);
      return id;
    });
  } catch {
    // Better Auth usa su propia transacción: compensar evita una cuenta huérfana.
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    throw new Error("No se pudo crear el negocio");
  }
  return { ok: true as const, negocio: await obtenerNegocio(organizationId), contrasenaTemporal };
}

async function cambiarEstado(input: { id: string; actorUserId: string }, reason: string | null) {
  return getDb().transaction(async (tx) => {
    const [negocio] = await tx.select({ id: schema.organization.id }).from(schema.organization)
      .where(eq(schema.organization.id, input.id)).for("update");
    if (!negocio) return false;
    const valores = { status: reason === null ? "active" as const : "suspended" as const,
      suspendedAt: reason === null ? null : new Date(), suspendedReason: reason };
    await tx.insert(schema.organizationPlatform).values({ organizationId: input.id, ...valores })
      .onConflictDoUpdate({ target: schema.organizationPlatform.organizationId, set: valores });
    if (reason !== null) {
      await tx.delete(schema.session).where(inArray(schema.session.userId,
        tx.select({ userId: schema.member.userId }).from(schema.member).where(eq(schema.member.organizationId, input.id))));
    }
    await auditar({ actorUserId: input.actorUserId, action: reason === null ? "org.reactivate" : "org.suspend",
      organizationId: input.id, targetUserId: null, detail: reason === null ? {} : { reason } }, tx);
    return true;
  });
}

export async function suspenderNegocio(input: { id: string; reason: string; actorUserId: string }) {
  return cambiarEstado(input, motivoSchema.parse(input.reason));
}
export async function reactivarNegocio(input: { id: string; actorUserId: string }) {
  return cambiarEstado(input, null);
}
export async function guardarNotasNegocio(input: { id: string; notes: string | null; actorUserId: string }) {
  const { notes } = notasNegocioSchema.parse({ notes: input.notes });
  return getDb().transaction(async (tx) => {
    const [negocio] = await tx.select({ id: schema.organization.id }).from(schema.organization)
      .where(eq(schema.organization.id, input.id)).for("update");
    if (!negocio) return false;
    await tx.insert(schema.organizationPlatform).values({ organizationId: input.id, notes })
      .onConflictDoUpdate({ target: schema.organizationPlatform.organizationId, set: { notes } });
    await auditar({ actorUserId: input.actorUserId, action: "org.notes", organizationId: input.id,
      targetUserId: null, detail: { notes } }, tx);
    return true;
  });
}
