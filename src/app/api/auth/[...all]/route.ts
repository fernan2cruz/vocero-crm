import { getAuth } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { registrarAcceso } from "@/server/platform/accesos";
import { plataformaEnabled } from "@/server/platform/flag";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return getAuth().handler(req);
}

export async function POST(req: Request) {
  const res = await getAuth().handler(req);
  // El limitador PROPIO de Better Auth (unos 3 inicios de sesión cada 10 s por
  // IP) responde 429 antes de nuestros enganches: sin esto, una inundación de
  // intentos quedaría casi invisible en el registro de accesos. El limitador
  // nuestro ya registra el suyo (mensaje distinto): no se duplica.
  if (
    res.status === 429 &&
    plataformaEnabled() &&
    new URL(req.url).pathname.endsWith("/sign-in/email")
  ) {
    const cuerpo = await res.clone().text().catch(() => "");
    if (!cuerpo.includes("Demasiados intentos")) {
      void registrarAcceso({
        kind: "failure",
        reason: "rate_limited",
        ip: clientIp(req.headers),
        userAgent: req.headers.get("user-agent"),
      });
    }
  }
  return res;
}
