import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { accionUsuarioSchema } from "@/server/platform/schemas";
import { desactivarUsuario, reactivarUsuario, reiniciarContrasena } from "@/server/platform/users";

export const POST = withSuperadmin(async (session, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const body = await parseBody(req, accionUsuarioSchema);
  if (!body.ok) return body.response;
  const input = { userId: (await ctx.params).id, actorUserId: session.userId };
  const datos = body.data;
  const resultado = datos.action === "disable" ? await desactivarUsuario({ ...input, reason: datos.reason })
    : datos.action === "enable" ? await reactivarUsuario(input) : await reiniciarContrasena(input);
  if (!resultado.ok) return apiError(resultado.code === "not_found" ? 404 : 409, resultado.code,
    resultado.code === "not_found" ? "Usuario no encontrado" : "Acción no permitida");
  return Response.json("contrasenaTemporal" in resultado
    ? { contrasenaTemporal: resultado.contrasenaTemporal } : { ok: true },
  { headers: { "Cache-Control": "no-store" } });
});
