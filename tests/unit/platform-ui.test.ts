import { describe, expect, it } from "vitest";
import { etiquetaEstado, etiquetaRol, formatoFecha, urlConFiltros, validarMotivo } from "@/lib/platform-ui";

describe("interfaz de plataforma", () => {
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
