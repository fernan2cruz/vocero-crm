import { withSuperadmin } from "@/server/platform/guard";
import { informeSinCache, responderInforme } from "@/server/platform/informes-http";
import { productividadPorNegocio } from "@/server/platform/productividad";

export const GET = informeSinCache(withSuperadmin(async (_session, req: Request) =>
  responderInforme(req, async ({ periodo, organizationId }) => {
    const negocios = await productividadPorNegocio(periodo);
    return Response.json({ periodo, negocios: organizationId === undefined ? negocios : negocios.filter((r) => r.organizationId === organizationId) });
  })));
