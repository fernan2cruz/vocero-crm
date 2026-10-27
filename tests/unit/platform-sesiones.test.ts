import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.getDb }));
import { schema } from "@/lib/db";
import { cerrarSesion, cerrarSesionesDeNegocio, cerrarSesionesDeUsuario } from "@/server/platform/sesiones";

let admin: boolean;
let condicion: { sql: string; params: unknown[] };
let auditoria: Record<string, unknown>[];
let fallo: boolean;
let borradas: boolean;
const db = {
  select: () => ({ from: (tabla: unknown) => ({ where: () => ({
    // El subquery conserva el contrato SQLWrapper que espera inArray de Drizzle.
    getSQL: () => sql`select user_id from member where organization_id = ${"org"}`,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(tabla === schema.platformAdmin && admin ? [{ id: "actor" }] : []).then(resolve),
  }) }) }),
  delete: (tabla: unknown) => ({ where: (filtro: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    expect(tabla).toBe(schema.session); condicion = new PgDialect().sqlToQuery(filtro);
    return { returning: async (campos: Record<string, unknown>) => {
      expect(Object.values(campos)).not.toContain(schema.session.token);
      borradas = true; return [{ id: "s", userId: "u", organizationId: "org" }];
    } };
  } }),
  insert: () => ({ values: async (valor: Record<string, unknown>) => {
    if (fallo) throw new Error("auditoría no disponible"); auditoria.push(valor);
  } }),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
    try { return await fn(db); } catch (error) { borradas = false; throw error; }
  },
};
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); mocks.getDb.mockReset().mockReturnValue(db);
  admin = true; auditoria = []; fallo = false; borradas = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("revocación de sesiones con base simulada", () => {
  it("usuario y negocio excluyen al actor superadmin y auditan el número", async () => {
    expect(await cerrarSesionesDeUsuario("u", { userId: "actor" })).toBe(1);
    expect(condicion.sql).toContain('"session"."user_id" <>');
    expect(condicion.params).toEqual(["u", "actor"]);
    expect(auditoria[0]).toMatchObject({ action: "session.revoke", targetUserId: "u", detail: { scope: "user", n: 1 } });
    expect(await cerrarSesionesDeNegocio("org", { userId: "actor" })).toBe(1);
    expect(condicion.sql).toContain('"session"."user_id" in (select');
    expect(condicion.sql).toContain('"session"."user_id" <>');
    expect(condicion.params).toEqual(["org", "actor"]);
    expect(auditoria[1]).toMatchObject({ organizationId: "org", detail: { scope: "org", n: 1 } });
  });
  it("cerrar una sesión explícita permite cerrarse y resuelve el destino de auditoría", async () => {
    expect(await cerrarSesion("s", { userId: "actor" })).toBe(1);
    expect(condicion.sql).not.toContain("<>"); expect(condicion.params).toEqual(["s"]);
    expect(auditoria[0]).toMatchObject({ targetUserId: "u", organizationId: "org", detail: { scope: "session", n: 1 } });
  });
  it("la protección se aplica solo al actor superadmin y revierte si falla auditoría", async () => {
    admin = false;
    await cerrarSesionesDeUsuario("u", { userId: "actor" });
    expect(condicion.sql).not.toContain("<>");
    fallo = true;
    await expect(cerrarSesion("s", { userId: "actor" })).rejects.toThrow("auditoría no disponible");
    expect(borradas).toBe(false);
  });
  it("apagada no consulta ni borra", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    expect(await cerrarSesion("s", { userId: "actor" })).toBe(0);
    expect(await cerrarSesionesDeUsuario("u", { userId: "actor" })).toBe(0);
    expect(await cerrarSesionesDeNegocio("org", { userId: "actor" })).toBe(0);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
