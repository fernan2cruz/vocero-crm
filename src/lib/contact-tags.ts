/**
 * 064 — Catálogo de etiquetas y segmentos de contactos. Sin imports de
 * servidor: lo leen también los componentes de cliente.
 */

export const TAG_COLORS = ["gris", "azul", "verde", "ambar", "rojo", "violeta"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  gris: "Gris",
  azul: "Azul",
  verde: "Verde",
  ambar: "Ámbar",
  rojo: "Rojo",
  violeta: "Violeta",
};

/** Clases Tailwind del punto de color (el texto sigue el tema). */
export const TAG_DOT_CLASS: Record<TagColor, string> = {
  gris: "bg-zinc-400",
  azul: "bg-blue-500",
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  rojo: "bg-red-500",
  violeta: "bg-violet-500",
};

export type ContactTagDto = { id: string; name: string; color: TagColor };

export type TagWithCount = ContactTagDto & { contacts: number };

/** Las claves que entiende `GET /api/contacts` y que un segmento puede guardar. */
export const SEGMENT_FILTER_KEYS = ["q", "stage", "tag", "source", "ai", "tipo"] as const;
export type SegmentFilterKey = (typeof SEGMENT_FILTER_KEYS)[number];
export type SegmentFilters = Partial<Record<SegmentFilterKey, string>>;

export type ContactSegmentDto = {
  id: string;
  name: string;
  filters: SegmentFilters;
};

/** Quita lo vacío: «todas» no es un filtro, es la ausencia de uno. */
export function limpiarFiltros(raw: Record<string, unknown>): SegmentFilters {
  const out: SegmentFilters = {};
  for (const k of SEGMENT_FILTER_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim() && v !== "all") out[k] = v.trim();
  }
  return out;
}
