import { apiError, withAuth } from "@/lib/api";
import { obtenerCampana } from "@/server/campaigns";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Estado y avance de la campaña (la pantalla lo consulta mientras envía). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const campaign = await obtenerCampana(session.organizationId, id);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");
  return Response.json({ campaign });
});
