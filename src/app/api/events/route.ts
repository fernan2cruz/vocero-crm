import { requireSession, UnauthorizedError } from "@/lib/auth/session";
import { subscribe } from "@/server/events/bus";
import { plataformaEnabled } from "@/server/platform/flag";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    throw err;
  }
  const { organizationId } = session;

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      const unsubscribe = subscribe(organizationId, (event) => {
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      let comprobando = false;
      const revalidacion = plataformaEnabled() ? setInterval(async () => {
        if (comprobando) return;
        comprobando = true;
        try {
          // Headers capturados al abrir: no dependemos del contexto de Next
          // dentro del temporizador ni de una sesión cacheada en la cookie.
          const actual = await requireSession(req.headers);
          if (actual.userId !== session.userId || actual.organizationId !== organizationId) cleanup?.();
        } catch {
          cleanup?.();
        } finally { comprobando = false; }
      }, 30_000) : null;

      cleanup = () => {
        clearInterval(heartbeat);
        if (revalidacion) clearInterval(revalidacion);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
