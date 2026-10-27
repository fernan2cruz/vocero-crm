import { APIError } from "better-auth/api";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.getDb }));
import { schema } from "@/lib/db";
import { alertasDeAcceso, eventosDeAcceso, motivoDeErrorAcceso, purgarAccesosAntiguos, registrarAcceso } from "@/server/platform/accesos";
import { accionSesionSchema, alertasAccesoSchema, auditoriaSchema, eventosAccesoSchema, rolUsuarioSchema, sesionesSchema } from "@/server/platform/schemas";
import { buscarAuditoria } from "@/server/platform/auditoria";
import { cambiarRol } from "@/server/platform/roles";
import { listarSesiones } from "@/server/platform/sesiones";

beforeEach(() => { mocks.getDb.mockReset(); vi.stubEnv("PLATAFORMA", "on"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("motivos de acceso sin distinguir cuenta inexistente de contraseña mala", () => {
  it.each([
    [new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" }), "bad_credentials"],
    [new APIError("FORBIDDEN", { message: "Cuenta desactivada" }), "disabled"],
    [new APIError("FORBIDDEN", { message: "Negocio suspendido" }), "suspended"],
    [new APIError("TOO_MANY_REQUESTS", { message: "Espera" }), "rate_limited"],
    [new APIError("UNAUTHORIZED", { code: "FAILED_TO_CREATE_SESSION" }), null],
    [new APIError("FORBIDDEN", { message: "Otro error" }), null],
    [new APIError("BAD_REQUEST", { code: "INVALID_EMAIL" }), null],
    [new Error("fallo desconocido"), null], [null, null], ["fallo", null],
  ])("mapea únicamente errores conocidos (%s)", (error, reason) => {
    expect(motivoDeErrorAcceso(error)).toBe(reason);
  });
});

describe("esquemas de accesos y auditoría", () => {
  it("valida límites, filtros, ventana y cursor", () => {
    expect(sesionesSchema.parse({ limit: "200" }).limit).toBe(200);
    for (const limit of [0, 201, 1.5, "NaN"]) {
      expect(sesionesSchema.safeParse({ limit }).success).toBe(false);
      expect(eventosAccesoSchema.safeParse({ limit }).success).toBe(false);
      expect(auditoriaSchema.safeParse({ limit }).success).toBe(false);
    }
    expect(eventosAccesoSchema.safeParse({ kind: "otro" }).success).toBe(false);
    expect(eventosAccesoSchema.safeParse({ organizationId: " " }).success).toBe(false);
    expect(alertasAccesoSchema.parse({}).ventanaHoras).toBe(24);
    expect(alertasAccesoSchema.safeParse({ ventanaHoras: -1 }).success).toBe(false);
    expect(auditoriaSchema.parse({ antes: "2026-10-27T00:00:00.000Z|aud_1" }).antes?.id).toBe("aud_1");
    for (const antes of ["ayer|id", "2026-02-30|id", "2026-10-27T00:00:00.000Z|", "2026-10-27T00:00:00.000Z|id|extra"]) {
      expect(auditoriaSchema.safeParse({ antes }).success).toBe(false);
    }
  });
  it("solo admite las tres acciones y roles del contrato", () => {
    for (const role of ["owner", "admin", "member"]) expect(rolUsuarioSchema.safeParse({ role }).success).toBe(true);
    expect(rolUsuarioSchema.safeParse({ role: "superadmin" }).success).toBe(false);
    expect(accionSesionSchema.safeParse({ action: "revoke", sessionId: "s" }).success).toBe(true);
    expect(accionSesionSchema.safeParse({ action: "revoke_user", userId: "u" }).success).toBe(true);
    expect(accionSesionSchema.safeParse({ action: "revoke_org", organizationId: "o" }).success).toBe(true);
    expect(accionSesionSchema.safeParse({ action: "revoke", userId: "u" }).success).toBe(false);
    expect(accionSesionSchema.safeParse({ action: "revoke", sessionId: "s", token: "secreto" }).success).toBe(false);
  });
});

describe("registro tolerante a fallos", () => {
  it("apagada ninguna operación nueva consulta la base", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    await registrarAcceso({ kind: "success", userId: "u" });
    expect(await alertasDeAcceso()).toEqual({ porIp: [], porCorreo: [] });
    expect(await purgarAccesosAntiguos()).toBe(0);
    expect(await listarSesiones()).toEqual([]);
    expect(await eventosDeAcceso({ desde: new Date(), hasta: new Date() })).toEqual([]);
    expect(await buscarAuditoria({ desde: new Date(), hasta: new Date() })).toEqual([]);
    expect(await cambiarRol({ userId: "u", role: "member", actorUserId: "a" })).toEqual({ ok: false, code: "disabled" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("normaliza y recorta; la inserción solo incluye metadatos", async () => {
    const values = vi.fn();
    mocks.getDb.mockReturnValue({ select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) }),
      insert: () => ({ values }) });
    await registrarAcceso({ kind: "failure", reason: "bad_credentials", email: `  ${"A".repeat(260)}  `, userAgent: "b".repeat(400) });
    expect(values).toHaveBeenCalledWith({ id: expect.stringMatching(/^lev_/), kind: "failure", reason: "bad_credentials",
      email: "a".repeat(254), userAgent: "b".repeat(300), userId: null, organizationId: null, ip: null });
  });
  it("un fallo del driver no se propaga ni imprime los valores", async () => {
    mocks.getDb.mockImplementation(() => { throw new Error("datos que no deben salir"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(registrarAcceso({ kind: "failure", email: "privado@example.com" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[platform] No se pudo registrar el acceso");
  });
});

describe("alertas con base simulada", () => {
  it("consulta solo fallos recientes, umbral 5, top 10 y valores distintos", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const consultas: string[] = [];
    let indice = 0;
    const resultados = [[{ ip: "ip1", fallos: 5, correos: ["a", "b"] }], [{ email: "a", fallos: 6, ips: ["ip1", "ip2"] }]];
    mocks.getDb.mockReturnValue({ select: (campos: Record<string, unknown>) => ({ from: (tabla: unknown) => {
      expect(tabla).toBe(schema.loginEvent);
      const lista = resultados[indice++];
      const agregacion = campos.correos ?? campos.ips;
      consultas.push(new PgDialect().sqlToQuery(agregacion as Parameters<PgDialect["sqlToQuery"]>[0]).sql);
      return { where: (condicion: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const q = new PgDialect().sqlToQuery(condicion); consultas.push(q.sql);
        expect(q.params).toContain("failure");
        expect(q.params).toContain("2026-10-26T12:00:00.000Z");
        return { groupBy: () => ({ having: (umbral: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          expect(new PgDialect().sqlToQuery(umbral).sql).toContain("count(*) >= 5");
          return { orderBy: () => ({ limit: async (n: number) => { expect(n).toBe(10); return lista; } }) };
        } }) };
      } };
    } }) });
    expect(await alertasDeAcceso()).toEqual({ porIp: resultados[0], porCorreo: resultados[1] });
    expect(consultas.filter((q) => q.includes("array_agg(distinct"))).toHaveLength(2);
    expect(consultas.filter((q) => q.includes("is not null"))).toHaveLength(2);
  });
});

describe("sesiones: proyección sin secretos", () => {
  it("ni el SELECT ni el DTO pueden incluir el token", async () => {
    mocks.getDb.mockReturnValue({ select: (campos: Record<string, unknown>) => {
      expect(Object.keys(campos)).toEqual(["id", "userId", "userName", "email", "organizationId", "organizationName", "ip", "userAgent", "createdAt", "expiresAt"]);
      expect(Object.values(campos)).not.toContain(schema.session.token);
      const datos = Object.fromEntries(Object.keys(campos).map((k) => [k, k]));
      const q = { innerJoin: () => q, leftJoin: () => q, where: (condicion: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        expect(new PgDialect().sqlToQuery(condicion).sql).toContain('"session"."expires_at" >'); return q;
      }, orderBy: () => q, limit: async () => [datos] };
      return { from: () => q };
    } });
    expect(JSON.stringify(await listarSesiones())).not.toContain("token");
  });
});
