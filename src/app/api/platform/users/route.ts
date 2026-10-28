import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { crearUsuarioSchema, listarUsuariosSchema } from "@/server/platform/schemas";
import { crearUsuario, listarUsuarios } from "@/server/platform/users";

export const POST = withSuperadmin(async (session, req: Request) => {
  const body = await parseBody(req, crearUsuarioSchema);
  if (!body.ok) return body.response;
  const resultado = await crearUsuario({ ...body.data, actorUserId: session.userId });
  if (!resultado.ok) return resultado.code === "email_taken"
    ? apiError(409, resultado.code, "Ya existe una cuenta con ese correo")
    : apiError(404, resultado.code, "Negocio no encontrado");
  return Response.json({ usuario: resultado.usuario, contrasenaTemporal: resultado.contrasenaTemporal },
    { status: 201, headers: { "Cache-Control": "no-store" } });
});

export const GET = withSuperadmin(async (_session, req: Request) => {
  const parametros = new URL(req.url).searchParams;
  const datos = listarUsuariosSchema.safeParse(Object.fromEntries(parametros));
  if (!datos.success) return apiError(422, "invalid_query", datos.error.message);
  return Response.json({ usuarios: await listarUsuarios(datos.data) });
});
