import { parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { accionSesionSchema } from "@/server/platform/schemas";
import { cerrarSesion, cerrarSesionesDeUsuario, cerrarSesionesDeNegocio } from "@/server/platform/sesiones";

export async function POST(req: Request) {
  const response = await withSuperadmin(async (session, req: Request) => {
    const body = await parseBody(req, accionSesionSchema);
    if (!body.ok) return body.response;
    const d = body.data;
    const n = d.action === "revoke" ? await cerrarSesion(d.sessionId, session)
      : d.action === "revoke_user" ? await cerrarSesionesDeUsuario(d.userId, session)
        : await cerrarSesionesDeNegocio(d.organizationId, session);
    return Response.json({ n });
  })(req);
  // También los errores de la guardia deben impedir el almacenamiento en caché.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
