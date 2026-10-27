/**
 * 064 — Línea de tiempo del cliente: tipos y la unión cronológica. Sin imports
 * de servidor: la lee también la interfaz.
 */

export const TIMELINE_KINDS = [
  "mensaje",
  "etapa",
  "cita",
  "nota",
  "venta",
  "alta",
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  mensaje: "Mensajes",
  etapa: "Etapas",
  cita: "Citas",
  nota: "Notas",
  venta: "Ventas",
  alta: "Alta",
};

export type TimelineItem = {
  /** Único dentro de su tipo; junto al tipo, de toda la línea. */
  id: string;
  kind: TimelineKind;
  /** ISO. */
  at: string;
  titulo: string;
  detalle: string | null;
  /** Solo en mensajes: quién lo dijo. */
  direccion?: "in" | "out";
};

/** Tope de la línea: lo más reciente primero, y se corta lo viejo. */
export const TIMELINE_MAX = 300;

/**
 * Une las fuentes en UNA línea, lo más reciente arriba. Desempata por tipo e id
 * para que dos eventos del mismo instante salgan siempre en el mismo orden (un
 * orden que salta entre recargas parece un error).
 */
export function unirLinea(fuentes: TimelineItem[][], max = TIMELINE_MAX): TimelineItem[] {
  return fuentes
    .flat()
    .sort((a, b) => {
      const d = Date.parse(b.at) - Date.parse(a.at);
      if (d !== 0) return d;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, max);
}

/** Un texto largo no debe hacer crecer la línea: se recorta con elipsis. */
export function recortar(texto: string | null | undefined, max = 140): string | null {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
