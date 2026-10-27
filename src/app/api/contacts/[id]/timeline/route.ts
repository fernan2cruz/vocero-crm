import { apiError, withAuth } from "@/lib/api";
import { lineaDeTiempo } from "@/server/contact-timeline";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Todo lo que le pasó al cliente, lo más reciente primero. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const items = await lineaDeTiempo(session.organizationId, id);
  if (!items) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ items });
});
