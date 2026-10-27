import { withSuperadmin } from "@/server/platform/guard";
import { csvConsumo, informeSinCache, responderInforme } from "@/server/platform/informes-http";
import { consumoPorNegocio } from "@/server/platform/consumo";

export const GET = informeSinCache(withSuperadmin(async (_session, req: Request) =>
  responderInforme(req, async ({ periodo }) => new Response(csvConsumo(await consumoPorNegocio(periodo)), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="consumo.csv"' },
  }))));
