import { withSuperadmin } from "@/server/platform/guard";
import { probarLlaveNegocio } from "@/server/platform/gestionado";

type Contexto = { params: Promise<{ id: string }> };

export const POST = withSuperadmin(async (_session, req: Request, ctx: Contexto) =>
  probarLlaveNegocio((await ctx.params).id, req));
