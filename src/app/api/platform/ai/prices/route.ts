import { parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/platform/guard";
import { precioIaSchema } from "@/server/platform/schemas";
import { guardarPrecioIa, preciosDeIa } from "@/server/platform/ai-usage";

export const GET = withSuperadmin(async () => Response.json({ precios: await preciosDeIa() }));
export const PUT = withSuperadmin(async (session, req: Request) => {
  const body = await parseBody(req, precioIaSchema);
  if (!body.ok) return body.response;
  await guardarPrecioIa(body.data, session.userId);
  return Response.json({ ok: true });
});
