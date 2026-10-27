import { apiError } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { sesionesSchema } from "@/server/platform/schemas";
import { listarSesiones } from "@/server/platform/sesiones";

export async function GET(req: Request) {
  const response = await withSuperadmin(async (_session, req: Request) => {
    const datos = sesionesSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!datos.success) return apiError(422, "invalid_query", datos.error.message);
    return Response.json({ sesiones: await listarSesiones(datos.data) });
  })(req);
  // También los errores de la guardia deben impedir el almacenamiento en caché.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
