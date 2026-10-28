import { afterEach, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const m = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
import { barrerAccesos, iniciarPurgaAccesos } from "@/server/platform/accesos";
afterEach(() => {
  const g = globalThis as unknown as { __voceroAccesosBarrido?: { timer: ReturnType<typeof setInterval> } };
  if (g.__voceroAccesosBarrido) clearInterval(g.__voceroAccesosBarrido.timer);
  delete g.__voceroAccesosBarrido;
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); m.db.mockReset();
});
it("apagada no programa ni consulta", async () => {
  vi.useFakeTimers(); vi.stubEnv("PLATAFORMA", "off");
  iniciarPurgaAccesos(); await barrerAccesos();
  expect(vi.getTimerCount()).toBe(0); expect(m.db).not.toHaveBeenCalled();
});
it("un temporizador por proceso, diario, lotes de 1000 y retención configurable", async () => {
  vi.useFakeTimers(); vi.stubEnv("PLATAFORMA", "on"); vi.stubEnv("ACCESS_RETENTION_DAYS", "7");
  vi.setSystemTime(new Date("2026-10-27T00:00:00Z"));
  const queries: string[] = [];
  let calls = 0;
  const builder = drizzle.mock();
  m.db.mockReturnValue({ select: builder.select.bind(builder), delete: () => ({ where: (s: SQL) => {
    const query = new PgDialect().sqlToQuery(s);
    queries.push(query.sql);
    expect(query.params).toContain(1000);
    expect(query.params).toContain(new Date(Date.now() - 7 * 86_400_000).toISOString());
    return { returning: async () => Array.from({ length: ++calls === 1 ? 1000 : 0 }, () => ({ id: "x" })) };
  } }) });
  iniciarPurgaAccesos(); iniciarPurgaAccesos();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1); expect(calls).toBe(2);
  expect(queries[0]).toContain("limit");
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(calls).toBe(3);
});
it("fallar no expone el error ni mata el barrido", async () => {
  vi.stubEnv("PLATAFORMA", "on");
  m.db.mockImplementation(() => { throw new Error("datos privados"); });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await barrerAccesos();
  expect(log).toHaveBeenCalledWith("[platform] No se pudieron purgar los accesos antiguos");
});
