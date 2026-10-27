import { apiError } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { listarUsuariosSchema } from "@/server/platform/schemas";
import { listarUsuarios } from "@/server/platform/users";

export const GET = withSuperadmin(async (_session, req: Request) => {
  const parametros = new URL(req.url).searchParams;
  const datos = listarUsuariosSchema.safeParse(Object.fromEntries(parametros));
  if (!datos.success) return apiError(422, "invalid_query", datos.error.message);
  return Response.json({ usuarios: await listarUsuarios(datos.data) });
});
