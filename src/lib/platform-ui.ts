export function etiquetaEstado(estado: "active" | "suspended" | "disabled"): string {
  return { active: "Activo", suspended: "Suspendido", disabled: "Desactivado" }[estado];
}

/** Dinero entero: redondeo a centavos, salvo importes menores de un centavo. */
export function formatearMicros(micros: number): string {
  if (!Number.isSafeInteger(micros)) throw new RangeError("Monto fuera del rango entero seguro");
  const valor = BigInt(micros);
  const absoluto = valor < 0n ? -valor : valor;
  const signo = valor < 0n ? "−" : "";
  if (absoluto > 0n && absoluto < 10_000n) {
    return `${signo}$0.${absoluto.toString().padStart(6, "0").replace(/0+$/, "")}`;
  }
  const centavos = (absoluto + 5_000n) / 10_000n;
  return `${signo}$${centavos / 100n}.${(centavos % 100n).toString().padStart(2, "0")}`;
}

/** Un punto o coma decimal; no admite agrupadores de miles ni exponentes. */
export function usdAMicros(texto: string): number | null {
  const partes = /^(-)?(?:\$\s*)?(\d+)(?:[.,](\d{1,6}))?$/.exec(texto.trim());
  if (!partes) return null;
  const absoluto = BigInt(partes[2]!) * 1_000_000n + BigInt((partes[3] ?? "").padEnd(6, "0"));
  const valor = partes[1] ? -absoluto : absoluto;
  if (valor > BigInt(Number.MAX_SAFE_INTEGER) || valor < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(valor);
}

export function etiquetaRol(rol: string | null): string {
  return rol === "owner" ? "Propietario" : rol === "admin" ? "Administrador" : rol === "member" ? "Miembro" : rol ?? "Sin rol";
}

/** UTC explícito: el servidor y el navegador muestran la misma fecha. */
export function formatoFecha(fecha: Date | string | null): string {
  if (!fecha) return "Sin registro";
  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) return "Sin registro";
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(valor) + " UTC";
}

export function validarMotivo(motivo: string): string | null {
  const longitud = motivo.trim().length;
  return longitud < 3 || longitud > 300 ? "Escribe un motivo de entre 3 y 300 caracteres." : null;
}

export function urlConFiltros(filtros: { q?: string; organizationId?: string }): string {
  const parametros = new URLSearchParams();
  if (filtros.q?.trim()) parametros.set("q", filtros.q.trim());
  if (filtros.organizationId?.trim()) parametros.set("organizationId", filtros.organizationId.trim());
  const consulta = parametros.toString();
  return `/platform/usuarios${consulta ? `?${consulta}` : ""}`;
}
