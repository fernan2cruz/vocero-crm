import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.getDb }));
import { buscarAuditoria, exportarAuditoriaCsv } from "@/server/platform/auditoria";

const periodo = { desde: new Date("2026-10-01T00:00:00Z"), hasta: new Date("2026-11-01T00:00:00Z") };
let consulta: { sql: string; params: unknown[] };
let orden: string[];
let uniones: number;
const fila = { id: "aud_1", createdAt: new Date("2026-10-27T12:00:00.001Z"), action: "user.role",
  actorName: "=formula", actorEmail: "actor@example.com", targetName: "Destino", targetEmail: "destino@example.com",
  organizationName: "Negocio", detail: { from: "member", to: "admin" } };
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); uniones = 0; orden = [];
  const q = { leftJoin: () => { uniones++; return q; }, where: (filtro: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    consulta = new PgDialect().sqlToQuery(filtro); return q;
  }, orderBy: (...campos: Parameters<PgDialect["sqlToQuery"]>[0][]) => {
    orden = campos.map((c) => new PgDialect().sqlToQuery(c).sql); return q;
  }, limit: async (n: number) => { expect(n).toBeLessThanOrEqual(200); return [fila]; } };
  mocks.getDb.mockReset().mockReturnValue({ select: () => ({ from: () => q }) });
});
afterEach(() => vi.unstubAllEnvs());

describe("bitácora consultable", () => {
  it("aplica periodo, negocio, actor y acción; cursor resuelve empates por id", async () => {
    expect(await buscarAuditoria({ ...periodo, organizationId: "org", actorUserId: "actor", accion: "user.role",
      antes: "2026-10-27T12:00:00.001Z|aud_2" })).toEqual([fila]);
    expect(uniones).toBe(3);
    expect(consulta.params).toEqual([periodo.desde.toISOString(), periodo.hasta.toISOString(), "org", "actor", "user.role",
      "2026-10-27T12:00:00.001Z", "2026-10-27T12:00:00.001Z", "aud_2"]);
    expect(consulta.sql).toContain("date_trunc('milliseconds'");
    expect(consulta.sql).toContain('"platform_audit"."id" <');
    expect(orden[0]).toContain("desc"); expect(orden[1]).toContain('"platform_audit"."id" desc');
  });
  it("exporta con lib/csv y neutraliza fórmulas en nombres", async () => {
    const csv = await exportarAuditoriaCsv(periodo);
    expect(csv).toContain("'=formula"); expect(csv).toContain("Negocio");
    expect(csv).toContain('"{""from"":""member"",""to"":""admin""}"');
    expect(csv).not.toContain("token");
  });
  it("rechaza cursor y límite inválidos antes de consultar", async () => {
    await expect(buscarAuditoria({ ...periodo, antes: "inválido" })).rejects.toThrow();
    await expect(buscarAuditoria({ ...periodo, limit: 201 })).rejects.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
