import { apiError } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { auditoriaSchema } from "@/server/platform/schemas";
import { exportarAuditoriaCsv } from "@/server/platform/auditoria";
import { resolverPeriodo, PeriodoInvalido } from "@/server/platform/periodo";

export async function GET(req: Request) {
  const response = await withSuperadmin(async (_session, req: Request) => {
    const raw = Object.fromEntries(new URL(req.url).searchParams);
    const datos = auditoriaSchema.safeParse(raw);
    if (!datos.success) return apiError(422, "invalid_query", datos.error.message);
    try {
      const csv = await exportarAuditoriaCsv({ ...datos.data, ...resolverPeriodo(datos.data), antes: raw.antes });
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="auditoria.csv"' } });
    } catch (error) {
      if (error instanceof PeriodoInvalido) return apiError(422, "invalid_query", error.message);
      throw error;
    }
  })(req);
  // También los errores de la guardia deben impedir el almacenamiento en caché.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
