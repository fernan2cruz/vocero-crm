export function etiquetaEstado(estado: "active" | "suspended" | "disabled"): string {
  return { active: "Activo", suspended: "Suspendido", disabled: "Desactivado" }[estado];
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
