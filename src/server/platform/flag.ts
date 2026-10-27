/**
 * 065 — Plataforma vive por encima de los negocios: no usa scoped() ni BD.
 * La migración viaja siempre; la bandera solo hace existir sus superficies.
 */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parsePlataformaFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/** Consultar la bandera no debe exigir que valide el entorno completo. */
export function plataformaEnabled(): boolean {
  return parsePlataformaFlag(process.env.PLATAFORMA);
}

/** 404 vacío: una plataforma apagada no revela su existencia. */
export function plataformaDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
