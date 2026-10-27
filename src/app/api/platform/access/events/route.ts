import { apiError } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { eventosAccesoSchema } from "@/server/platform/schemas";
import { eventosDeAcceso } from "@/server/platform/accesos";
import { resolverPeriodo, PeriodoInvalido } from "@/server/platform/periodo";

export async function GET(req: Request) {
  const response = await withSuperadmin(async (_session, req: Request) => {
    const datos = eventosAccesoSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!datos.success) return apiError(422, "invalid_query", datos.error.message);
    try {
      return Response.json({ eventos: await eventosDeAcceso({ ...datos.data, ...resolverPeriodo(datos.data) }) });
    } catch (error) {
      if (error instanceof PeriodoInvalido) return apiError(422, "invalid_query", error.message);
      throw error;
    }
  })(req);
  // También los errores de la guardia deben impedir el almacenamiento en caché.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
