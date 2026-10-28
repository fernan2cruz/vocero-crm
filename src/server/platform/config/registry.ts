import { z } from "zod";

const texto = z.string().trim().min(1).max(4096);
/** Un App secret real de Meta son 32 hex; 16 ya distingue un valor pegado de un dedazo. */
const secretoMeta = z.string().trim().min(16).max(4096);
const url = texto.url().refine((v) => {
  const u = new URL(v);
  return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
}, "Usa una URL http(s) sin credenciales, consulta ni fragmento");
const entrada = <S extends z.ZodTypeAny>(key: string, etiqueta: string, grupo: string,
  tipo: "secreto" | "texto" | "booleano" | "entero" | "lista", defecto: z.infer<S>, validacion: S, ayuda: string) =>
  ({ key, etiqueta, grupo, tipo, env: key, default: defecto, validacion, ayuda });

/** Catálogo único, sin acceso a BD: también describe el formulario público del portal. */
export const registroConfig = {
  META_APP_SECRET: entrada("META_APP_SECRET", "App secret de Meta", "WhatsApp y Meta", "secreto", "", secretoMeta, "App secret en Meta → Configuración → Básica (32 caracteres hex). Obligatorio para recibir entregas firmadas en la plataforma."),
  META_WEBHOOK_VERIFY_TOKEN: entrada("META_WEBHOOK_VERIFY_TOKEN", "Token de verificación", "WhatsApp y Meta", "secreto", "", texto.min(8).regex(/^[A-Za-z0-9_-]+$/), "Se genera automáticamente si falta. Usa letras, números, guiones o guiones bajos. Cambiarlo exige actualizar el webhook en Meta."),
  META_GRAPH_API_VERSION: entrada("META_GRAPH_API_VERSION", "Versión de Graph API", "WhatsApp y Meta", "texto", "v25.0", z.string().regex(/^v\d+\.\d+$/), "Versión de la API oficial de Meta, por ejemplo v25.0."),
  ALLOW_SIGNUP: entrada("ALLOW_SIGNUP", "Permitir registro público", "Registro", "booleano", false, z.boolean(), "Permite crear cuentas desde el registro público. El primer superadmin se crea por el procedimiento de instalación."),
  ACCESS_RETENTION_DAYS: entrada("ACCESS_RETENTION_DAYS", "Retención de accesos (días)", "Registro", "entero", 180, z.number().int().positive().max(2147483647), "Antigüedad del historial de accesos que conserva la purga diaria."),
  CHANNELS: entrada("CHANNELS", "Canales", "Módulos", "lista", ["whatsapp"], z.array(z.enum(["whatsapp", "instagram", "messenger", "tiktok"])).min(1).refine((v) => v.includes("whatsapp"), "WhatsApp debe permanecer activo"), "Canales disponibles para todos los negocios. WhatsApp siempre está activo."),
  AGENDA: entrada("AGENDA", "Agenda", "Módulos", "booleano", false, z.boolean(), "Habilita las citas y sus conectores opcionales."),
  ATRIBUCION: entrada("ATRIBUCION", "Atribución de anuncios", "Módulos", "booleano", false, z.boolean(), "Habilita la captura de clics y el reporte de conversiones a Meta."),
  ZERNIO_BASE_URL: entrada("ZERNIO_BASE_URL", "URL base de Zernio", "Avanzado", "texto", "https://zernio.com/api/v1", url, "Dirección del transporte opcional de canales sociales."),
  IG_GRAPH_BASE_URL: entrada("IG_GRAPH_BASE_URL", "URL base de Instagram", "Avanzado", "texto", "https://graph.instagram.com", url, "Dirección de Graph API para Instagram."),
} as const;
export type ClaveConfig = keyof typeof registroConfig;
export type ValorConfig<K extends ClaveConfig> = z.infer<(typeof registroConfig)[K]["validacion"]>;
export const clavesConfig = Object.keys(registroConfig) as ClaveConfig[];
export function esClaveConfig(key: string): key is ClaveConfig {
  return Object.hasOwn(registroConfig, key);
}

export function respaldoConfig<K extends ClaveConfig>(key: K): ValorConfig<K> {
  const def = registroConfig[key];
  const raw = process.env[def.env];
  if (!raw) return def.default as ValorConfig<K>;
  // Se conserva la semántica histórica del entorno (incluidos los valores de banderas).
  if (def.tipo === "booleano") return (key === "ALLOW_SIGNUP" ? raw === "true" :
    ["on", "1", "true", "si", "sí", "yes"].includes(raw.trim().toLowerCase())) as ValorConfig<K>;
  if (def.tipo === "lista") return raw.split(",").map((s) => s.trim().toLowerCase()) as ValorConfig<K>;
  // El portal valida al guardar. El respaldo conserva lo que el consumidor
  // histórico recibía, sin endurecer instalaciones de un solo negocio.
  return (def.tipo === "entero" ? Number(raw) : raw) as ValorConfig<K>;
}
