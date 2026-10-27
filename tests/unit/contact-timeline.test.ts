import { describe, expect, it } from "vitest";
import {
  TIMELINE_MAX,
  recortar,
  unirLinea,
  type TimelineItem,
} from "@/lib/contact-timeline";

const it_ = (id: string, kind: TimelineItem["kind"], at: string): TimelineItem => ({
  id,
  kind,
  at,
  titulo: id,
  detalle: null,
});

describe("064 — unirLinea", () => {
  it("lo más reciente primero, mezclando fuentes", () => {
    const linea = unirLinea([
      [it_("m1", "mensaje", "2026-01-01T10:00:00.000Z")],
      [it_("v1", "venta", "2026-03-01T10:00:00.000Z")],
      [it_("e1", "etapa", "2026-02-01T10:00:00.000Z")],
    ]);
    expect(linea.map((i) => i.id)).toEqual(["v1", "e1", "m1"]);
  });

  it("el empate es estable: por tipo y luego por id", () => {
    const at = "2026-01-01T10:00:00.000Z";
    const a = unirLinea([[it_("b", "nota", at), it_("a", "nota", at), it_("z", "cita", at)]]);
    const b = unirLinea([[it_("z", "cita", at), it_("a", "nota", at), it_("b", "nota", at)]]);
    expect(a.map((i) => i.id)).toEqual(["z", "a", "b"]);
    expect(b).toEqual(a);
  });

  it("corta lo más viejo al pasar el tope", () => {
    const muchos = Array.from({ length: TIMELINE_MAX + 20 }, (_, n) =>
      it_(`m${n}`, "mensaje", new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString())
    );
    const linea = unirLinea([muchos]);
    expect(linea).toHaveLength(TIMELINE_MAX);
    expect(linea[0]?.id).toBe(`m${TIMELINE_MAX + 19}`);
  });

  it("sin fuentes, vacío", () => {
    expect(unirLinea([])).toEqual([]);
    expect(unirLinea([[], []])).toEqual([]);
  });
});

describe("064 — recortar", () => {
  it("vacío o espacios → null", () => {
    expect(recortar(null)).toBeNull();
    expect(recortar("   \n ")).toBeNull();
  });

  it("junta espacios y saltos de línea", () => {
    expect(recortar("hola\n\n  mundo")).toBe("hola mundo");
  });

  it("recorta con elipsis dentro del máximo", () => {
    const r = recortar("x".repeat(500), 20);
    expect(r).toHaveLength(20);
    expect(r?.endsWith("…")).toBe(true);
  });
});
