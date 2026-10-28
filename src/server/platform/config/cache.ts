import { plataformaEnabled } from "@/server/platform/flag";
import { respaldoConfig, type ClaveConfig, type ValorConfig } from "./registry";

export type ValorGuardado = { valor: unknown; autogenerado: boolean };
let cache = new Map<ClaveConfig, ValorGuardado>();
let vence = 0;
let revision = 0;
let refrescar: (() => Promise<void>) | undefined;
export function revisionConfig() { return revision; }
export function instalarRefrescoConfig(fn: () => Promise<void>) { refrescar = fn; }
export function publicarConfig(valores: Map<ClaveConfig, ValorGuardado>, version: number) {
  if (revision !== version) return;
  cache = valores;
  vence = Date.now() + 30_000;
}
export function invalidarConfig() { revision++; cache = new Map(); vence = 0; }
export function configVencida() { return Date.now() >= vence; }
export function guardadoConfig(key: ClaveConfig) { return plataformaEnabled() ? cache.get(key) : undefined; }
/** Distingue un respaldo explícito de un default, incluso si sus valores coinciden. */
export function configDefinida(key: ClaveConfig): boolean {
  return !!guardadoConfig(key) || !!process.env[key];
}

/** Sin plataforma no importa el repositorio, no valida el entorno ni toca la BD. */
export function configSync<K extends ClaveConfig>(key: K): ValorConfig<K> {
  if (!plataformaEnabled()) return respaldoConfig(key);
  if (configVencida()) void refrescar?.();
  return (cache.get(key)?.valor ?? respaldoConfig(key)) as ValorConfig<K>;
}
