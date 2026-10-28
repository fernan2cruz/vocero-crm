import { plataformaEnabled } from "@/server/platform/flag";
import { respaldoConfig, type ClaveConfig, type ValorConfig } from "./registry";

export type ValorGuardado = { valor: unknown; autogenerado: boolean };
type EstadoConfig = {
  cache: Map<ClaveConfig, ValorGuardado>; vence: number; revision: number;
  refrescar?: () => Promise<void>; pendiente?: Promise<void>;
};
const g = globalThis as unknown as { __wassapiConfig?: EstadoConfig };
/** Next puede evaluar este módulo en bundles distintos de rutas e instrumentation. */
export function estadoConfig(): EstadoConfig {
  return g.__wassapiConfig ??= { cache: new Map(), vence: 0, revision: 0 };
}
export function revisionConfig() { return estadoConfig().revision; }
export function instalarRefrescoConfig(fn: () => Promise<void>) { estadoConfig().refrescar = fn; }
export function publicarConfig(valores: Map<ClaveConfig, ValorGuardado>, version: number) {
  const estado = estadoConfig();
  if (estado.revision !== version) return;
  estado.cache = valores;
  estado.vence = Date.now() + 30_000;
}
export function invalidarConfig() { const estado = estadoConfig(); estado.revision++; estado.cache = new Map(); estado.vence = 0; }
export function configVencida() { return Date.now() >= estadoConfig().vence; }
export function guardadoConfig(key: ClaveConfig) { return plataformaEnabled() ? estadoConfig().cache.get(key) : undefined; }
/** Distingue un respaldo explícito de un default, incluso si sus valores coinciden. */
export function configDefinida(key: ClaveConfig): boolean {
  return !!guardadoConfig(key) || !!process.env[key];
}

/** Sin plataforma no importa el repositorio, no valida el entorno ni toca la BD. */
export function configSync<K extends ClaveConfig>(key: K): ValorConfig<K> {
  if (!plataformaEnabled()) return respaldoConfig(key);
  if (configVencida()) void estadoConfig().refrescar?.();
  return (estadoConfig().cache.get(key)?.valor ?? respaldoConfig(key)) as ValorConfig<K>;
}
