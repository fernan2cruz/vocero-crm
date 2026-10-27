import { apiError, parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { rolUsuarioSchema } from "@/server/platform/schemas";
import { cambiarRol } from "@/server/platform/roles";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const response = await withSuperadmin(async (session, req: Request) => {
    const body = await parseBody(req, rolUsuarioSchema);
    if (!body.ok) return body.response;
    const resultado = await cambiarRol({ userId: (await ctx.params).id, role: body.data.role, actorUserId: session.userId });
    if (!resultado.ok) return apiError(409, resultado.code, "No se pudo cambiar el rol");
    return Response.json({ ok: true });
  })(req);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
