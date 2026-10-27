import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { markBotSeen } from "@/server/bot/status";
import { credencialValida } from "@/server/bot/org-credential";
import { plataformaEnabled } from "@/server/platform/flag";
import { estadoDeNegocio } from "@/server/platform/estado";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador, en su mismo servidor) que quiere
 * conducir la conversación sin que el token de WhatsApp salga del CRM.
 * Con X-Vocero-Organization exige la credencial derivada de ese negocio;
 * sin ella conserva BOT_API_KEY heredada. Ambas se comparan en tiempo
 * constante. Sin BOT_API_KEY configurada, toda la superficie responde 401.
 *
 * Primero se autentica y DESPUÉS se cuenta. Antes había un solo cubo global
 * contado antes de mirar la key: 600 requests anónimos por minuto dejaban al
 * cerebro en 429 el resto de la ventana, y los clientes sin respuesta.
 */

const MIN_KEY_LENGTH = 16;

/** La superficie está abierta: hay `BOT_API_KEY` y no es débil. Una key
 *  corta equivale a no tenerla (todo responde 401). */
export function isBotKeyConfigured(): boolean {
  const key = process.env.BOT_API_KEY;
  return typeof key === "string" && key.length >= MIN_KEY_LENGTH;
}

/**
 * Presupuesto del cerebro AUTENTICADO: 1200/min (20/s sostenidos). Nea hace
 * ~4-10 llamadas por turno de cliente (contexto, "escribiendo…", 1-3
 * mensajes y, cuando aplica, ficha, handoff, agenda o adjuntos): alcanza para
 * 120-300 turnos por minuto, por encima del pico de un solo negocio. Un
 * cerebro desbocado en un bucle queda en 20/s, carga que el monolito absorbe
 * sin que la bandeja lo note.
 */
export const BOT_API_BUDGET = { windowMs: 60_000, max: 1200 };

/**
 * Autenticaciones FALLIDAS por IP: 30/min, y luego 429. Jamás tocan el
 * presupuesto de arriba, y una key correcta pasa aunque su IP esté frenada:
 * detrás del mismo proxy (o sin proxy, donde todo es "local") el cerebro puede
 * compartir IP con quien inunda. Adivinar la key tampoco es el riesgo: mide
 * 16+ caracteres.
 */
export const BOT_AUTH_FAILURES = { windowMs: 60_000, max: 30 };

/**
 * 036 — La llave llega en `X-API-Key` o, para `/api/bot/llm`, como
 * `Authorization: Bearer`: es lo que manda el SDK de OpenAI del cerebro, que
 * apunta su `base_url` al CRM y no sabe de cabeceras propias.
 */
function llaveDe(req: Request): string | null {
  const directa = req.headers.get("x-api-key");
  if (directa) return directa;
  const auth = req.headers.get("authorization");
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null;
  return m?.[1] ?? null;
}

export function requireBotKey(req: Request): Response | null {
  const organizationId = req.headers.get("x-vocero-organization");
  const provided = llaveDe(req);
  const valid = organizationId !== null
    ? isBotKeyConfigured() && provided !== null && credencialValida(process.env.BOT_API_KEY!, organizationId, provided)
    : validBotKey(provided);
  if (!valid) {
    const ip = clientIp(req.headers);
    const fails = checkRateLimit(`bot-api-fail:${ip}`, BOT_AUTH_FAILURES);
    return fails.allowed
      ? apiError(401, "unauthorized", "No autorizado")
      : apiError(429, "rate_limited", "Demasiados intentos fallidos");
  }
  // «Quién responde»: la única huella que deja el cerebro externo en el CRM.
  // Se marca al autenticar, antes del presupuesto: un cerebro frenado por 429
  // sigue siendo el que contesta.
  if (organizationId !== null) markBotSeen(organizationId);
  else markBotSeen();
  const rl = checkRateLimit(organizationId !== null ? `bot-api:${organizationId}` : "bot-api", BOT_API_BUDGET);
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");
  return null;
}

function validBotKey(provided: string | null): boolean {
  const expected = process.env.BOT_API_KEY;
  if (!expected || !isBotKeyConfigured() || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Se llama después de requireBotKey: jamás elegimos un negocio arbitrario.
 * Sin caché: el superadmin puede dar de alta otro negocio en runtime. */
export async function resolveBotOrg(req: Request): Promise<
  { ok: true; organizationId: string } | { ok: false; response: Response }
> {
  const db = getDb();
  const indicada = req.headers.get("x-vocero-organization");
  // organization es el catálogo de Better Auth, sin columna organization_id.
  const consulta = db.select({ id: schema.organization.id }).from(schema.organization);
  const rows = indicada !== null
    ? await consulta.where(eq(schema.organization.id, indicada)).limit(1)
    : await consulta.limit(2);
  if (indicada !== null && !rows[0]) {
    return { ok: false, response: apiError(401, "unauthorized", "No autorizado") };
  }
  if (!rows[0]) {
    return { ok: false, response: apiError(409, "no_org", "La instancia aún no tiene organización") };
  }
  if (indicada === null && rows.length > 1) {
    return { ok: false, response: apiError(409, "org_ambiguous", "Con varios negocios, indica X-Vocero-Organization") };
  }
  const organizationId = rows[0].id;
  if (plataformaEnabled() && await estadoDeNegocio(organizationId) === "suspended") {
    return { ok: false, response: apiError(403, "org_suspended", "Negocio suspendido") };
  }
  // En el modo heredado solo ahora conocemos a qué negocio atribuir la llamada.
  markBotSeen(organizationId);
  return { ok: true, organizationId };
}

/** Compatibilidad con los tests anteriores: ya no existe caché permanente. */
export function resetInstanceOrgCache(): void {}
