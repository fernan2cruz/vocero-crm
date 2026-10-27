import { describe, expect, it } from "vitest";
import { etiquetaEstado, etiquetaRol, formatoFecha, formatearMicros, usdAMicros, urlConFiltros, validarMotivo } from "@/lib/platform-ui";

describe("interfaz de plataforma", () => {
  it("formatea micros con signo y conserva importes menores de un centavo", () => {
    for (const [micros, esperado] of [[0, "$0.00"], [1_250_000, "$1.25"], [-500_000, "−$0.50"], [2_000, "$0.002"], [1, "$0.000001"], [-9_999, "−$0.009999"], [10_000, "$0.01"], [1_995_000, "$2.00"], [Number.MAX_SAFE_INTEGER, "$9007199254.74"]] as const) {
      expect(formatearMicros(micros)).toBe(esperado);
    }
    expect(() => formatearMicros(0.1)).toThrow(RangeError);
  });
  it("convierte decimales a micros exactos sin redondear", () => {
    for (const [texto, esperado] of [["1.25", 1_250_000], ["1,25", 1_250_000], ["$ 1.25", 1_250_000], [" -0.50 ", -500_000], ["-$ 0.000001", -1], ["0", 0], ["1000.123456", 1_000_123_456], ["1,000", 1_000_000], ["9007199254.740991", Number.MAX_SAFE_INTEGER]] as const) {
      expect(usdAMicros(texto)).toBe(esperado);
    }
  });
  it("rechaza vacíos, agrupadores de miles, precisión excesiva y montos inseguros", () => {
    for (const texto of ["", " ", "abc", "-", "1.1234567", "1,1234567", "1,000.00", "1.000,00", "1 000", "1,000,000", "1e3", "NaN", "Infinity", "1.", "9007199254.740992", "-9007199254.740992"]) {
      expect(usdAMicros(texto)).toBeNull();
    }
  });
  it("presenta los estados y roles en español", () => {
    expect([etiquetaEstado("active"), etiquetaEstado("suspended"), etiquetaEstado("disabled")]).toEqual(["Activo", "Suspendido", "Desactivado"]);
    expect([etiquetaRol("owner"), etiquetaRol("admin"), etiquetaRol("member"), etiquetaRol(null)]).toEqual(["Propietario", "Administrador", "Miembro", "Sin rol"]);
  });
  it("valida los límites del motivo después de quitar espacios", () => {
    for (const motivo of ["", "  ", " ab ", "x".repeat(301)]) expect(validarMotivo(motivo)).not.toBeNull();
    for (const motivo of [" abc ", "x".repeat(300)]) expect(validarMotivo(motivo)).toBeNull();
  });
  it("muestra fechas estables en UTC y tolera fechas ausentes o inválidas", () => {
    expect(formatoFecha(null)).toBe("Sin registro");
    expect(formatoFecha("inválida")).toBe("Sin registro");
    expect(formatoFecha("2026-10-27T12:30:00Z")).toMatch(/27.*2026.*12:30.*UTC/);
    expect(formatoFecha(new Date("2026-10-27T12:30:00Z"))).toBe(formatoFecha("2026-10-27T08:30:00-04:00"));
  });
  it("omite filtros vacíos y codifica caracteres reservados sin alterar la ruta", () => {
    expect(urlConFiltros({ q: "  ", organizationId: "" })).toBe("/platform/usuarios");
    const url = new URL(urlConFiltros({ q: "  María + & ?  ", organizationId: "org/1" }), "https://ejemplo.test");
    expect(url.pathname).toBe("/platform/usuarios");
    expect(url.searchParams.get("q")).toBe("María + & ?");
    expect(url.searchParams.get("organizationId")).toBe("org/1");
    expect(urlConFiltros({ organizationId: "org_1" })).toBe("/platform/usuarios?organizationId=org_1");
    expect(urlConFiltros({ q: "Ana" })).toBe("/platform/usuarios?q=Ana");
  });
});
