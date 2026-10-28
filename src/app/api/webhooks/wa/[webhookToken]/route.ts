import { configSync } from "@/server/platform/config/cache";
import { isValidSignature, isValidWebhookToken, metaSignatureUnavailable } from "@/server/inbox/webhook";
import { recibirEvento } from "@/server/webhooks/recibir";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 solo si META_APP_SECRET está configurado.
 * 047: tras validar, el evento se guarda ANTES de responder 200 y se procesa
 * fuera de la ruta; si falla, el barrido lo reintenta. Si no se pudo guardar,
 * 503 para que Meta reintente (`src/server/webhooks/recibir.ts`).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, configSync("META_WEBHOOK_VERIFY_TOKEN"))) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === configSync("META_WEBHOOK_VERIFY_TOKEN")) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, configSync("META_WEBHOOK_VERIFY_TOKEN"))) {
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();
  if (metaSignatureUnavailable(configSync("META_APP_SECRET"))) return new Response(null, { status: 503 });
  const signature = req.headers.get("x-hub-signature-256");
  if (!isValidSignature(rawBody, signature, configSync("META_APP_SECRET"))) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  return recibirEvento("whatsapp", payload, rawBody, "webhook");
}
