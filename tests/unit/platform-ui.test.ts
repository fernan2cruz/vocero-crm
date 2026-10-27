import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { etiquetaEstado, etiquetaRol, formatoFecha, formatearMicros, usdAMicros, urlConFiltros, validarMotivo, formatearDuracion, etiquetaRiesgo, proporcion, parametrosDePeriodo } from "@/lib/platform-ui";

const informes = vi.hoisted(() => ({ guardia: vi.fn(), consumo: vi.fn(), serie: vi.fn(), modelos: vi.fn(), productividad: vi.fn(), resumen: vi.fn() }));
vi.mock("@/server/platform/guard", () => ({ requireSuperadmin: informes.guardia, PlataformaNoEncontrada: class extends Error {} }));
vi.mock("@/server/platform/consumo", () => ({ consumoPorNegocio: informes.consumo, serieDiaria: informes.serie, consumoPorModelo: informes.modelos }));
vi.mock("@/server/platform/productividad", () => ({ productividadPorNegocio: informes.productividad }));
vi.mock("@/server/platform/resumen", () => ({ resumenPlataforma: informes.resumen }));
vi.mock("@/components/platform/selector-periodo", () => ({ SelectorPeriodo: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));

import ResumenPage from "@/app/(platform)/platform/page";
import ConsumoPage from "@/app/(platform)/platform/consumo/page";
import ProductividadPage from "@/app/(platform)/platform/productividad/page";
import { PlataformaNoEncontrada } from "@/server/platform/guard";

beforeEach(() => {
  vi.clearAllMocks();
  informes.guardia.mockResolvedValue(undefined);
  informes.consumo.mockResolvedValue([]); informes.serie.mockResolvedValue([]); informes.modelos.mockResolvedValue([]); informes.productividad.mockResolvedValue([]);
});

describe("pantallas de informes en el servidor", () => {
  const fechas = { from: "2026-10-01", to: "2026-10-07" };
  it.each([ResumenPage, ConsumoPage, ProductividadPage])("un periodo inválido muestra alerta sin consultar el informe", async (pagina) => {
    const html = renderToStaticMarkup(await pagina({ searchParams: Promise.resolve({ days: "367" }) }));
    expect(html).toContain('role="alert"'); expect(html).toContain("366");
    for (const consulta of [informes.consumo, informes.serie, informes.modelos, informes.productividad, informes.resumen]) expect(consulta).not.toHaveBeenCalled();
  });
  it.each([ResumenPage, ConsumoPage, ProductividadPage])("oculta la superficie antes de consultar al denegar la guardia", async (pagina) => {
    informes.guardia.mockRejectedValueOnce(new PlataformaNoEncontrada());
    await expect(pagina({ searchParams: Promise.resolve(fechas) })).rejects.toThrow("404");
    expect(informes.consumo).not.toHaveBeenCalled(); expect(informes.productividad).not.toHaveBeenCalled(); expect(informes.resumen).not.toHaveBeenCalled();
  });
  it("la gráfica global consulta sin filtro y ofrece los valores diarios accesibles", async () => {
    informes.serie.mockResolvedValue([{ dia: "2026-10-01", llamadas: 3, costoMicros: 2500000 }]);
    const html = renderToStaticMarkup(await ConsumoPage({ searchParams: Promise.resolve(fechas) }));
    expect(informes.serie).toHaveBeenCalledWith(expect.objectContaining({ dias: 7 }), undefined);
    expect(informes.modelos).not.toHaveBeenCalled();
    expect(html).toContain('role="img"'); expect(html).toContain("<desc"); expect(html).toContain("Valores del consumo diario en UTC"); expect(html).toContain("$2.50");
  });
  it("aplica el negocio a serie, modelos y enlace de exportación", async () => {
    const html = renderToStaticMarkup(await ConsumoPage({ searchParams: Promise.resolve({ ...fechas, organizationId: "org_a" }) }));
    expect(informes.serie).toHaveBeenCalledWith(expect.objectContaining({ dias: 7 }), "org_a");
    expect(informes.modelos).toHaveBeenCalledWith(expect.objectContaining({ dias: 7 }), "org_a");
    expect(html).toContain("/api/platform/usage/export?from=2026-10-01&amp;to=2026-10-07&amp;organizationId=org_a");
    expect(html).toContain("Consumo por modelo");
  });
  it("conserva days en la exportación y al cambiar el filtro", async () => {
    const html = renderToStaticMarkup(await ConsumoPage({ searchParams: Promise.resolve({ days: "7", organizationId: "org_a" }) }));
    expect(html).toContain("/api/platform/usage/export?days=7&amp;organizationId=org_a");
    expect(html).toContain("/platform/consumo?days=7");
  });
  it("productividad presenta mediana, monedas separadas y encabezados ordenables", async () => {
    informes.productividad.mockResolvedValue([{ organizationId: "org_a", nombre: "Negocio", conversaciones: 2, mensajesEntrantes: 3, mensajesSalientes: 4, pctAgente: 50,
      primeraRespuestaMedianaSeg: 90, traspasos: 1, citas: { total: 3, realizadas: 2 }, tratosGanados: 1, ventas: { porMoneda: { USD: 100, MXN: 200 } } }]);
    const html = renderToStaticMarkup(await ProductividadPage({ searchParams: Promise.resolve(fechas) }));
    expect(html).toContain("1 min 30 s"); expect(html).toContain("USD</span>"); expect(html).toContain("MXN</span>");
    expect(html).toContain('aria-sort="ascending"'); expect(html).toContain("El Laboratorio no cuenta");
  });
  it("el resumen muestra riesgos traducidos y barras proporcionales", async () => {
    informes.resumen.mockResolvedValue({ negocios: { activos: 2, suspendidos: 1 }, usuarios: 4, consumo: { costoMicros: 3000000, llamadas: 5 }, creditoTotalMicros: 0,
      enRiesgo: [{ organizationId: "org_a", nombre: "A", motivos: ["sin_credito", "cerebro_sin_senal"] }],
      topConsumo: [{ organizationId: "org_a", nombre: "A", costoMicros: 2000000 }, { organizationId: "org_b", nombre: "B", costoMicros: 1000000 }] });
    const html = renderToStaticMarkup(await ResumenPage({ searchParams: Promise.resolve(fechas) }));
    expect(html).toContain("Sin crédito"); expect(html).toContain("Cerebro sin señal"); expect(html).toContain("width:50%"); expect(html).toContain("/platform/negocios/org_b");
  });
});

describe("interfaz de plataforma", () => {
  it("presenta duraciones y valores ausentes", () => {
    for (const [seg, texto] of [[null, "—"], [45, "45 s"], [90, "1 min 30 s"], [7500, "2 h 5 min"], [0, "0 s"], [60, "1 min"], [3600, "1 h"], [59.8, "1 min"], [NaN, "—"], [-1, "—"]] as const) expect(formatearDuracion(seg)).toBe(texto);
  });
  it("traduce cada motivo de riesgo", () => {
    expect((["sin_credito", "credito_bajo", "agente_apagado", "webhooks_agotados", "suspendido", "cerebro_sin_senal"] as const).map(etiquetaRiesgo)).toEqual(["Sin crédito", "Crédito bajo", "Agente apagado", "Webhooks agotados", "Suspendido", "Cerebro sin señal"]);
  });
  it("limita proporciones y evita NaN", () => {
    for (const [v, m, esperado] of [[5, 10, 50], [20, 10, 100], [-2, 10, 0], [1, 0, 0], [0, 0, 0], [NaN, 1, 0], [1, Infinity, 0], [1, -1, 0]]) expect(proporcion(v!, m!)).toBe(esperado);
  });
  it("limpia parámetros ajenos, vacíos y repetidos y conserva errores para validación", () => {
    expect(parametrosDePeriodo({ from: " 2026-10-01 ", to: "2026-10-27", days: " 7 ", q: "basura" })).toEqual({ from: "2026-10-01", to: "2026-10-27", days: 7 });
    expect(parametrosDePeriodo({ from: ["a", "b"], to: " ", days: "", otro: "x" })).toEqual({});
    expect(parametrosDePeriodo({ from: "fecha inválida", days: "367" })).toEqual({ from: "fecha inválida", days: 367 });
    expect(parametrosDePeriodo({ days: "basura" }).days).toBeNaN();
  });
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
