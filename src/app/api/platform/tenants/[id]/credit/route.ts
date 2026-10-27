import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { obtenerNegocio } from "@/server/platform/tenants";
import { acreditar, ajustar, libroDe, saldoDe } from "@/server/platform/credit";
import { creditoSchema } from "@/server/platform/schemas";

type Contexto = { params: Promise<{ id: string }> };
export const GET = withSuperadmin(async (_session, _req: Request, ctx: Contexto) => {
  const { id } = await ctx.params;
  if (!(await obtenerNegocio(id))) return apiError(404, "not_found", "Negocio no encontrado");
  const [saldoMicros, libro] = await Promise.all([saldoDe(id), libroDe(id, { limit: 200 })]);
  return Response.json({ saldoMicros, libro });
});
export const POST = withSuperadmin(async (session, req: Request, ctx: Contexto) => {
  const body = await parseBody(req, creditoSchema);
  if (!body.ok) return body.response;
  const { id } = await ctx.params;
  if (!(await obtenerNegocio(id))) return apiError(404, "not_found", "Negocio no encontrado");
  const input = { organizationId: id, amountMicros: body.data.amountMicros,
    note: body.data.note, actorUserId: session.userId };
  const saldoMicros = await (body.data.action === "grant" ? acreditar(input) : ajustar(input));
  return Response.json({ saldoMicros });
});
