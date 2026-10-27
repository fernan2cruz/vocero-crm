import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { crearNegocioSchema } from "@/server/platform/schemas";
import { crearNegocio, listarNegocios } from "@/server/platform/tenants";

export const GET = withSuperadmin(async () => Response.json({ negocios: await listarNegocios() }));
export const POST = withSuperadmin(async (session, req: Request) => {
  const body = await parseBody(req, crearNegocioSchema);
  if (!body.ok) return body.response;
  const resultado = await crearNegocio({ ...body.data, actorUserId: session.userId });
  if (!resultado.ok) return apiError(409, resultado.code, "Ya existe una cuenta con ese correo");
  return Response.json({ negocio: resultado.negocio, contrasenaTemporal: resultado.contrasenaTemporal },
    { status: 201, headers: { "Cache-Control": "no-store" } });
});
