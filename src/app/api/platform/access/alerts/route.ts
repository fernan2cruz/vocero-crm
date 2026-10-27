import { apiError } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { alertasAccesoSchema } from "@/server/platform/schemas";
import { alertasDeAcceso } from "@/server/platform/accesos";

export async function GET(req: Request) {
  const response = await withSuperadmin(async (_session, req: Request) => {
    const datos = alertasAccesoSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!datos.success) return apiError(422, "invalid_query", datos.error.message);
    return Response.json(await alertasDeAcceso(datos.data));
  })(req);
  // También los errores de la guardia deben impedir el almacenamiento en caché.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
