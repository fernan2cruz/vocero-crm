import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { editarNegocioSchema } from "@/server/platform/schemas";
import { guardarNotasNegocio, obtenerNegocio, reactivarNegocio, suspenderNegocio } from "@/server/platform/tenants";

type Contexto = { params: Promise<{ id: string }> };
export const GET = withSuperadmin(async (_session, _req: Request, ctx: Contexto) => {
  const negocio = await obtenerNegocio((await ctx.params).id);
  return negocio ? Response.json({ negocio }) : apiError(404, "not_found", "Negocio no encontrado");
});
export const PATCH = withSuperadmin(async (session, req: Request, ctx: Contexto) => {
  const body = await parseBody(req, editarNegocioSchema);
  if (!body.ok) return body.response;
  const input = { id: (await ctx.params).id, actorUserId: session.userId };
  const datos = body.data;
  const existe = "notes" in datos ? await guardarNotasNegocio({ ...input, notes: datos.notes })
    : datos.action === "suspend" ? await suspenderNegocio({ ...input, reason: datos.reason })
      : await reactivarNegocio(input);
  return existe ? Response.json({ ok: true }) : apiError(404, "not_found", "Negocio no encontrado");
});
