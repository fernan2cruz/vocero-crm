import { describe, expect, it } from "vitest";
import {
  SEGMENT_FILTER_KEYS,
  TAG_COLORS,
  TAG_DOT_CLASS,
  limpiarFiltros,
} from "@/lib/contact-tags";

describe("064 — limpiarFiltros", () => {
  it("quita lo vacío y «all»: no son filtros", () => {
    expect(
      limpiarFiltros({ q: "  ", stage: "all", tag: "", source: "all" })
    ).toEqual({});
  });

  it("conserva lo que sí filtra, recortado", () => {
    expect(
      limpiarFiltros({ q: " ana ", stage: "Interesado", tag: "tag_1", ai: "paused" })
    ).toEqual({ q: "ana", stage: "Interesado", tag: "tag_1", ai: "paused" });
  });

  it("ignora claves que GET /api/contacts no entiende y valores no texto", () => {
    expect(limpiarFiltros({ evil: "x", tag: 5, stage: "Nuevo" })).toEqual({
      stage: "Nuevo",
    });
    expect(Object.keys(limpiarFiltros({ evil: "x" }))).toHaveLength(0);
  });

  it("las claves del segmento son exactamente las del endpoint", () => {
    expect([...SEGMENT_FILTER_KEYS].sort()).toEqual(
      ["ai", "q", "source", "stage", "tag", "tipo"]
    );
  });
});

describe("064 — colores de etiqueta", () => {
  it("cada color tiene su clase de punto", () => {
    for (const c of TAG_COLORS) expect(TAG_DOT_CLASS[c]).toMatch(/^bg-/);
  });
});
