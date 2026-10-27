import { withSuperadmin } from "@/server/platform/guard";
import { guardarLlaveNegocio, leerLlaveNegocio, revocarLlaveNegocio } from "@/server/platform/gestionado";

type Contexto = { params: Promise<{ id: string }> };

export const GET = withSuperadmin(async (_session, _req: Request, ctx: Contexto) =>
  leerLlaveNegocio((await ctx.params).id));

export const PUT = withSuperadmin(async (session, req: Request, ctx: Contexto) =>
  guardarLlaveNegocio((await ctx.params).id, session.userId, req));

export const DELETE = withSuperadmin(async (session, _req: Request, ctx: Contexto) =>
  revocarLlaveNegocio((await ctx.params).id, session.userId));
