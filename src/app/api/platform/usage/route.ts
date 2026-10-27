import { withSuperadmin } from "@/server/platform/guard";
import { informeSinCache, responderInforme } from "@/server/platform/informes-http";
import { consumoPorNegocio, consumoPorModelo, serieDiaria } from "@/server/platform/consumo";

export const GET = informeSinCache(withSuperadmin(async (_session, req: Request) =>
  responderInforme(req, async ({ periodo, organizationId }) => {
    const [negocios, modelos, serie] = await Promise.all([
      consumoPorNegocio(periodo), consumoPorModelo(periodo, organizationId), serieDiaria(periodo, organizationId),
    ]);
    return Response.json({ periodo, negocios, modelos, serie });
  })));
