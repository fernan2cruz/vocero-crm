import type { PlatformAction } from "@/server/platform/audit";

export function formatearDuracion(seg: number | null): string {
  if (seg === null || !Number.isFinite(seg) || seg < 0) return "—";
  const s = Math.round(seg);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(s / 3600)} h${Math.floor(s % 3600 / 60) ? ` ${Math.floor(s % 3600 / 60)} min` : ""}`;
}

export function etiquetaRiesgo(motivo: "sin_credito" | "credito_bajo" | "agente_apagado" | "webhooks_agotados" | "suspendido" | "cerebro_sin_senal"): string {
  return { sin_credito: "Sin crédito", credito_bajo: "Crédito bajo", agente_apagado: "Agente apagado", webhooks_agotados: "Webhooks agotados", suspendido: "Suspendido", cerebro_sin_senal: "Cerebro sin señal" }[motivo];
}

export function proporcion(valor: number, max: number): number {
  return !Number.isFinite(valor) || !Number.isFinite(max) || max <= 0 ? 0 : Math.min(100, Math.max(0, valor / max * 100));
}

export type ParametrosPagina = Record<string, string | string[] | undefined>;
/** Solo escalares no vacíos; resolverPeriodo valida fechas y límites. */
export function parametrosDePeriodo(searchParams: ParametrosPagina): { from?: string; to?: string; days?: number } {
  const texto = (clave: string) => typeof searchParams[clave] === "string" ? searchParams[clave].trim() || undefined : undefined;
  const from = texto("from"), to = texto("to"), days = texto("days");
  return { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(days ? { days: Number(days) } : {}) };
}

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
export const accionesPlataforma = {
  "platform.admin.grant": "Otorgar superadmin", "platform.admin.revoke": "Retirar superadmin",
  "org.create": "Crear negocio", "org.suspend": "Suspender negocio", "org.reactivate": "Reactivar negocio",
  "credit.adjust": "Ajustar crédito", "credit.low": "Crédito de IA bajo", "credit.depleted": "Crédito de IA agotado",
  "ai_key.set": "Guardar llave de IA", "ai_key.revoke": "Revocar llave de IA",
  "ai.mode": "Cambiar modo de IA", "ai.price": "Cambiar precio de IA", "session.revoke": "Cerrar sesiones",
  "user.disable": "Desactivar usuario", "user.enable": "Reactivar usuario", "user.role": "Cambiar rol",
  "user.password_reset": "Reiniciar contraseña", "org.notes": "Editar notas del negocio",
} satisfies Record<PlatformAction, string>;

export function etiquetaAccion(accion: string): string {
  return Object.hasOwn(accionesPlataforma, accion) ? accionesPlataforma[accion as PlatformAction] : accion;
}

/** Proyección explícita: nunca volcar objetos, credenciales ni JSON desconocido. */
export function resumenDetalle(accion: string, detail: unknown): string {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "Sin detalle";
  const d = detail as Record<string, unknown>;
  const partes: string[] = [];
  const texto = (clave: string, etiqueta: string) => { if (typeof d[clave] === "string" && d[clave].trim()) partes.push(`${etiqueta}: ${d[clave]}`); };
  const monto = (clave: string, etiqueta: string) => { if (typeof d[clave] === "number" && Number.isSafeInteger(d[clave])) partes.push(`${etiqueta}: ${formatearMicros(d[clave])} USD`); };
  texto("reason", "Motivo"); texto("note", "Nota");
  if (accion === "user.role") {
    if (typeof d.from === "string" && typeof d.to === "string") partes.push(`${etiquetaRol(d.from)} → ${etiquetaRol(d.to)}`);
  } else if (accion === "credit.adjust") {
    monto("amountMicros", "Monto"); monto("balanceAfter", "Saldo después");
  } else if (accion === "credit.low" || accion === "credit.depleted") {
    monto("balanceAfter", "Saldo");
  } else if (accion === "session.revoke") {
    if (typeof d.n === "number" && Number.isSafeInteger(d.n) && d.n >= 0) partes.push(`${d.n} sesiones cerradas`);
    if (d.scope === "user" || d.scope === "org" || d.scope === "session") partes.push(`Alcance: ${d.scope === "user" ? "usuario" : d.scope === "org" ? "negocio" : "sesión"}`);
  } else if (accion === "ai.mode") {
    if (d.aiMode === "own_key" || d.aiMode === "platform") partes.push(d.aiMode === "own_key" ? "Llave propia" : "IA de plataforma");
  } else if (accion === "ai.price") {
    texto("model", "Modelo"); monto("inputPerMillionMicros", "Entrada por millón de tokens"); monto("outputPerMillionMicros", "Salida por millón de tokens");
  } else if (accion === "ai_key.set" || accion === "ai_key.revoke") {
    if (d.scope === "org" || d.scope === "platform") partes.push(d.scope === "org" ? "Llave del negocio" : "Llave de plataforma");
    texto("provider", "Proveedor"); texto("model", "Modelo");
  } else if (accion === "org.create") {
    texto("name", "Nombre"); texto("ownerEmail", "Propietario");
  } else if (accion === "org.notes") partes.push(d.notes === null ? "Notas eliminadas" : "Notas actualizadas");
  return partes.join(" · ") || "Sin detalle adicional";
}

export function navegadorLegible(userAgent: string | null | undefined): string {
  if (!userAgent?.trim()) return "Sin registro";
  const navegador = /Edg(?:e|A|iOS)?\//i.test(userAgent) ? "Edge" : /(?:OPR|Opera)\//i.test(userAgent) ? "Opera" : /(?:Firefox|FxiOS)\//i.test(userAgent) ? "Firefox" : /(?:Chrome|CriOS)\//i.test(userAgent) ? "Chrome" : /Version\/.*Safari\//i.test(userAgent) ? "Safari" : null;
  const sistema = /Android/i.test(userAgent) ? "Android" : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS" : /Windows/i.test(userAgent) ? "Windows" : /Macintosh|Mac OS X/i.test(userAgent) ? "macOS" : /Linux/i.test(userAgent) ? "Linux" : null;
  return navegador ? `${navegador}${sistema ? ` en ${sistema}` : ""}` : userAgent.trim().slice(0, 100) + (userAgent.trim().length > 100 ? "…" : "");
}

export function etiquetaResultadoAcceso(kind: string, reason: string | null): string {
  if (kind === "success") return "Correcto";
  switch (reason) {
    case "bad_credentials": return "Contraseña incorrecta";
    case "disabled": return "Desactivada";
    case "suspended": return "Suspendido";
    case "rate_limited": return "Demasiados intentos";
    default: return "Fallido";
  }
}
