import { apiError, withAuth } from "@/lib/api";
import { deleteSegment } from "@/server/contact-tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await deleteSegment(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Segmento no encontrado");
  return Response.json({ ok: true });
});
