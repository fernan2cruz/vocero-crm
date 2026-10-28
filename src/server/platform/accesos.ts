/** Consultas globales de seguridad, con filtros explícitos; nunca leen credenciales. */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { configSync } from "./config/cache";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { plataformaEnabled } from "./flag";
import { alertasAccesoSchema, eventosAccesoSchema } from "./schemas";

type Motivo = NonNullable<typeof schema.loginEvent.$inferInsert.reason>;
/** Solo errores reconocidos: un fallo interno de sesión no significa contraseña mala. */
export function motivoDeErrorAcceso(error: unknown): Motivo | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { statusCode?: unknown; body?: { code?: unknown; message?: unknown } };
  if (e.statusCode === 429) return "rate_limited";
  if (e.statusCode === 401 && e.body?.code === "INVALID_EMAIL_OR_PASSWORD") return "bad_credentials";
  if (e.statusCode === 403 && e.body?.message === "Cuenta desactivada") return "disabled";
  if (e.statusCode === 403 && e.body?.message === "Negocio suspendido") return "suspended";
  return null;
}

export async function registrarAcceso(input: {
  kind: "success" | "failure"; reason?: Motivo; userId?: string; email?: string;
  organizationId?: string | null; ip?: string | null; userAgent?: string | null;
}): Promise<void> {
  if (!plataformaEnabled()) return;
  try {
    const db = getDb();
    // Solo se guarda lo que PARECE un correo: es común que alguien escriba su
    // contraseña en el campo de correo, y esa jamás debe quedar en el registro.
    const crudo = typeof input.email === "string" ? input.email.trim().toLowerCase() : null;
    const email = crudo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(crudo) ? crudo.slice(0, 254) : null;
    // Resolver únicamente identidad y membresía permite filtrar fallos por negocio.
    const identidades = await db.select({ userId: schema.user.id, email: schema.user.email,
      organizationId: schema.member.organizationId }).from(schema.user)
      .leftJoin(schema.member, eq(schema.member.userId, schema.user.id))
      .where(input.userId ? eq(schema.user.id, input.userId) : sql`lower(${schema.user.email}) = ${email}`)
      .limit(2);
    const identidad = identidades[0];
    await db.insert(schema.loginEvent).values({ id: newId("loginEvent"), kind: input.kind,
      reason: input.reason ?? null, userId: input.userId ?? identidad?.userId ?? null,
      email: email ?? identidad?.email.trim().toLowerCase().slice(0, 254) ?? null,
      // Sin negocio explícito, varias membresías no permiten atribuir el intento a uno.
      organizationId: input.organizationId ?? (identidades.length === 1 ? identidad?.organizationId : null) ?? null,
      ip: input.ip ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null });
  } catch {
    // No imprimir el error del driver: podría incluir valores del intento.
    console.error("[platform] No se pudo registrar el acceso");
  }
}

export async function purgarAccesosAntiguos(dias = 180) {
  if (!plataformaEnabled()) return 0;
  if (!Number.isInteger(dias) || dias < 1) throw new Error("Antigüedad inválida");
  const db = getDb();
  const antiguas = db.select({ id: schema.loginEvent.id }).from(schema.loginEvent)
    .where(lt(schema.loginEvent.createdAt, new Date(Date.now() - dias * 86_400_000)))
    .limit(1000);
  const filas = await db.delete(schema.loginEvent)
    .where(inArray(schema.loginEvent.id, antiguas))
    .returning({ id: schema.loginEvent.id });
  return filas.length;
}

const g = globalThis as unknown as {
  __voceroAccesosBarrido?: { timer: ReturnType<typeof setInterval>; corriendo: boolean };
};

export async function barrerAccesos(): Promise<void> {
  if (!plataformaEnabled()) return;
  const e = g.__voceroAccesosBarrido;
  if (e?.corriendo) return;
  if (e) e.corriendo = true;
  try {
    const dias = configSync("ACCESS_RETENTION_DAYS");
    while (await purgarAccesosAntiguos(dias) === 1000) { /* Lotes acotados. */ }
  } catch {
    console.error("[platform] No se pudieron purgar los accesos antiguos");
  } finally {
    if (e) e.corriendo = false;
  }
}

export function iniciarPurgaAccesos(): void {
  if (!plataformaEnabled() || g.__voceroAccesosBarrido) return;
  const timer = setInterval(() => void barrerAccesos(), 86_400_000);
  timer.unref?.();
  g.__voceroAccesosBarrido = { timer, corriendo: false };
  void barrerAccesos();
}

export async function eventosDeAcceso(input: {
  desde: Date; hasta: Date; organizationId?: string; kind?: "success" | "failure"; limit?: number;
}) {
  if (!plataformaEnabled()) return [];
  const { limit, organizationId, kind } = eventosAccesoSchema.parse({
    limit: input.limit, organizationId: input.organizationId, kind: input.kind,
  });
  const t = schema.loginEvent;
  return getDb().select({ id: t.id, userId: t.userId, email: t.email, organizationId: t.organizationId,
    kind: t.kind, reason: t.reason, ip: t.ip, userAgent: t.userAgent, createdAt: t.createdAt,
    userName: schema.user.name, organizationName: schema.organization.name }).from(t)
    .leftJoin(schema.user, eq(schema.user.id, t.userId))
    .leftJoin(schema.organization, eq(schema.organization.id, t.organizationId))
    .where(and(gte(t.createdAt, input.desde), lt(t.createdAt, input.hasta),
      organizationId ? eq(t.organizationId, organizationId) : undefined, kind ? eq(t.kind, kind) : undefined))
    .orderBy(desc(t.createdAt), desc(t.id)).limit(limit);
}

export async function alertasDeAcceso(input: { ventanaHoras?: number } = {}) {
  if (!plataformaEnabled()) return { porIp: [], porCorreo: [] };
  const { ventanaHoras } = alertasAccesoSchema.parse(input);
  const t = schema.loginEvent;
  const filtro = and(eq(t.kind, "failure"), gte(t.createdAt, new Date(Date.now() - ventanaHoras * 3_600_000)),
    lt(t.createdAt, new Date()));
  const fallos = sql<number>`count(*)`.mapWith(Number);
  const db = getDb();
  const [porIp, porCorreo] = await Promise.all([
    db.select({ ip: t.ip, fallos,
      correos: sql<string[]>`array_remove(array_agg(distinct ${t.email}), null)` }).from(t)
      .where(and(filtro, sql`${t.ip} is not null and ${t.ip} <> ''`)).groupBy(t.ip)
      .having(sql`count(*) >= 5`).orderBy(desc(fallos), t.ip).limit(10),
    db.select({ email: t.email, fallos,
      ips: sql<string[]>`array_remove(array_agg(distinct ${t.ip}), null)` }).from(t)
      .where(and(filtro, sql`${t.email} is not null and ${t.email} <> ''`)).groupBy(t.email)
      .having(sql`count(*) >= 5`).orderBy(desc(fallos), t.email).limit(10),
  ]);
  return { porIp, porCorreo };
}
