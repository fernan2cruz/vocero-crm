import { apiError, withAuth } from "@/lib/api";
import { deleteSale } from "@/server/contact-sales";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; saleId: string }> };

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id, saleId } = await ctx.params;
  const ok = await deleteSale(session.organizationId, id, saleId);
  if (!ok) return apiError(404, "not_found", "Venta no encontrada");
  return Response.json({ ok: true });
});
