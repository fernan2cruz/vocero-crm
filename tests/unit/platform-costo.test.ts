import { describe, expect, it } from "vitest";
import { costoDeUso } from "@/server/platform/ai-usage";

const precio = { inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 3_000_000 };
describe("costo de IA en micros enteros", () => {
  it("manda el costo reportado, incluido cero", () => {
    expect(costoDeUso({ promptTokens: 10, completionTokens: 20, precio, costoReportadoUsd: 0.0012345 })).toBe(1235);
    expect(costoDeUso({ promptTokens: 10, completionTokens: 20, precio, costoReportadoUsd: 0 })).toBe(0);
  });
  it("usa tokens por precio y redondea al final", () => {
    expect(costoDeUso({ promptTokens: 10, completionTokens: 20, precio })).toBe(70);
    expect(costoDeUso({ promptTokens: 1, completionTokens: 1,
      precio: { inputPerMillionMicros: 250_000, outputPerMillionMicros: 250_000 } })).toBe(1);
  });
  it("sin precio o sin tokens el costo es cero", () => {
    expect(costoDeUso({ promptTokens: 100, completionTokens: 200 })).toBe(0);
    expect(costoDeUso({ promptTokens: 0, completionTokens: 0, precio })).toBe(0);
  });
  it("evita pérdida de precisión en productos intermedios grandes", () => {
    expect(costoDeUso({ promptTokens: 2_000_000_000, completionTokens: 0,
      precio: { inputPerMillionMicros: 1_000_000_001, outputPerMillionMicros: 0 } })).toBe(2_000_000_002_000);
  });
  it.each([NaN, Infinity, -1, Number.MAX_VALUE])("rechaza costo inválido o fuera de rango: %s", (costoReportadoUsd) => {
    expect(() => costoDeUso({ promptTokens: 1, completionTokens: 1, costoReportadoUsd })).toThrow();
  });
  it("rechaza tokens fraccionarios y resultados inseguros", () => {
    expect(() => costoDeUso({ promptTokens: 0.5, completionTokens: 1, precio })).toThrow();
    expect(() => costoDeUso({ promptTokens: 2_147_483_647, completionTokens: 0,
      precio: { inputPerMillionMicros: Number.MAX_SAFE_INTEGER, outputPerMillionMicros: 0 } })).toThrow();
  });
});
