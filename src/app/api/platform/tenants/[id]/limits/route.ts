import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { obtenerNegocio } from "@/server/platform/tenants";
import { fijarLimites, limitesDe, usoActualDe } from "@/server/platform/limites";
import { limitesSchema } from "@/server/platform/schemas";

type Contexto = { params: Promise<{ id: string }> };
export const GET = withSuperadmin(async (_session, _req: Request, ctx: Contexto) => {
  const { id } = await ctx.params;
  if (!(await obtenerNegocio(id))) return apiError(404, "not_found", "Negocio no encontrado");
  const [limites, uso] = await Promise.all([limitesDe(id), usoActualDe(id)]);
  return Response.json({ limites, uso });
});
export const PUT = withSuperadmin(async (session, req: Request, ctx: Contexto) => {
  const body = await parseBody(req, limitesSchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  if (!(await fijarLimites(id, body.data, session.userId))) return apiError(404, "not_found", "Negocio no encontrado");
  return Response.json({ limites: body.data });
});
