import { afterEach, describe, expect, it, vi } from "vitest";
import { diasDelPeriodo, PeriodoInvalido, resolverPeriodo } from "@/server/platform/periodo";

afterEach(() => vi.useRealTimers());
describe("periodos UTC de plataforma", () => {
  it("incluye hoy UTC y los 29 días anteriores", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T23:59:59-04:00"));
    const p = resolverPeriodo();
    expect(p).toEqual({ desde: new Date("2025-12-04Z"), hasta: new Date("2026-01-03Z"), dias: 30 });
    expect(diasDelPeriodo(p)).toHaveLength(30);
  });
  it("acepta un día y to inclusivo", () => {
    const p = resolverPeriodo({ from: "2024-02-29", to: "2024-02-29" });
    expect(diasDelPeriodo(p)).toEqual(["2024-02-29"]);
    expect(p.hasta.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
  it("admite 366 días bisiestos y rechaza 367", () => {
    expect(resolverPeriodo({ from: "2024-01-01", to: "2024-12-31" }).dias).toBe(366);
    expect(() => resolverPeriodo({ from: "2024-01-01", to: "2025-01-01" })).toThrow(PeriodoInvalido);
  });
  it("recorre meses y años sin saltos", () => {
    expect(diasDelPeriodo(resolverPeriodo({ from: "2023-12-31", to: "2024-01-02" }))).toEqual(["2023-12-31", "2024-01-01", "2024-01-02"]);
    expect(diasDelPeriodo(resolverPeriodo({ from: "2024-02-28", to: "2024-03-01" }))).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  });
  it.each(["2023-02-29", "2024-02-30", "2024-04-31", "2024-13-01", "2024-00-01", "2024-01-00", "2024-1-01", "", "no", "2024-01-01T00:00:00Z"])("rechaza %s en ambos extremos", (fecha) => {
    expect(() => resolverPeriodo({ from: fecha })).toThrow(PeriodoInvalido);
    expect(() => resolverPeriodo({ to: fecha })).toThrow(PeriodoInvalido);
  });
  it.each([0, -1, 367, 1.5, NaN, Infinity])("rechaza days=%s", (days) => expect(() => resolverPeriodo({ days })).toThrow(PeriodoInvalido));
  it("rechaza fechas invertidas", () => expect(() => resolverPeriodo({ from: "2024-03-01", to: "2024-02-29" })).toThrow(PeriodoInvalido));
  it("resuelve extremos opcionales y days", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2024-03-01T12:00:00Z"));
    expect(diasDelPeriodo(resolverPeriodo({ days: 1 }))).toEqual(["2024-03-01"]);
    expect(resolverPeriodo({ days: 366 }).dias).toBe(366);
    expect(resolverPeriodo({ from: "2024-02-29" }).dias).toBe(2);
    expect(diasDelPeriodo(resolverPeriodo({ to: "2024-02-29", days: 2 }))).toEqual(["2024-02-28", "2024-02-29"]);
    expect(resolverPeriodo({ from: "2024-01-01", to: "2024-01-02", days: 1 }).dias).toBe(2);
  });
});
