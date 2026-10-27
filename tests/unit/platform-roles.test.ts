import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.getDb }));
import { schema } from "@/lib/db";
import { cambiarRol } from "@/server/platform/roles";

let admin: boolean;
let miembros: { id: string; organizationId: string }[];
let role: string;
let owners: number;
let auditoria: Record<string, unknown>[];
let falloAudit: boolean;
const bloqueos: string[] = [];
const db = {
  execute: async () => { bloqueos.push("superadmin"); },
  select: (campos: Record<string, unknown>) => ({ from: (tabla: unknown) => ({ where: () => {
    const resultado = tabla === schema.platformAdmin ? (admin ? [{ id: "u" }] : [])
      : tabla === schema.organization ? [{ id: "org" }]
        : "role" in campos ? [{ role }]
          : "organizationId" in campos ? miembros : Array.from({ length: owners }, (_, i) => ({ id: `m${i}` }));
    return { then: (resolve: (valor: unknown) => unknown) => Promise.resolve(resultado).then(resolve),
      for: async () => { bloqueos.push(tabla === schema.organization ? "negocio" : "miembro"); return resultado; } };
  } }) }),
  update: () => ({ set: (datos: { role: string }) => ({ where: async () => { role = datos.role; } }) }),
  insert: () => ({ values: async (datos: Record<string, unknown>) => {
    if (falloAudit) throw new Error("fallo de auditoría"); auditoria.push(datos);
  } }),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
    const anterior = role;
    try { return await fn(db); } catch (error) { role = anterior; throw error; }
  },
};
const input = { userId: "u", role: "member" as const, actorUserId: "a" };
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); mocks.getDb.mockReturnValue(db);
  admin = false; miembros = [{ id: "m", organizationId: "org" }]; role = "owner"; owners = 1;
  auditoria = []; falloAudit = false; bloqueos.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("cambiar rol con base simulada", () => {
  it("conserva al último propietario y no audita un rechazo", async () => {
    expect(await cambiarRol(input)).toEqual({ ok: false, code: "last_owner" });
    expect(role).toBe("owner"); expect(auditoria).toEqual([]);
    expect(bloqueos).toEqual(["superadmin", "negocio", "miembro"]);
  });
  it("cambia y audita con más de un propietario", async () => {
    owners = 2;
    expect(await cambiarRol(input)).toEqual({ ok: true });
    expect(role).toBe("member");
    expect(auditoria[0]).toMatchObject({ action: "user.role", organizationId: "org", actorUserId: "a", targetUserId: "u", detail: { from: "owner", to: "member" } });
  });
  it("puede promover otro propietario", async () => {
    role = "member";
    expect(await cambiarRol({ ...input, role: "owner" })).toEqual({ ok: true });
    expect(role).toBe("owner");
  });
  it("rechaza superadmin, ausencia y ambigüedad de membresía", async () => {
    admin = true;
    expect(await cambiarRol(input)).toEqual({ ok: false, code: "is_superadmin" });
    admin = false; miembros = [];
    expect(await cambiarRol(input)).toEqual({ ok: false, code: "no_membership" });
    miembros = [{ id: "1", organizationId: "1" }, { id: "2", organizationId: "2" }];
    expect(await cambiarRol(input)).toEqual({ ok: false, code: "ambiguous_membership" });
    expect(auditoria).toEqual([]);
  });
  it("mismo rol no escribe y un fallo de auditoría revierte el cambio", async () => {
    expect(await cambiarRol({ ...input, role: "owner" })).toEqual({ ok: true });
    expect(auditoria).toEqual([]);
    owners = 2; falloAudit = true;
    await expect(cambiarRol(input)).rejects.toThrow("fallo de auditoría");
    expect(role).toBe("owner");
  });
});
