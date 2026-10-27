import { apiError, parseBody } from "@/lib/api";
import { ajustesIaPlataforma, guardarIaPlataforma } from "@/server/platform/ai-usage";
import { aiSettingsPutSchema, baseUrlEfectiva } from "@/server/ai/settings";
import { withSuperadmin } from "@/server/platform/guard";

export const GET = withSuperadmin(async () => Response.json(await ajustesIaPlataforma()));
export const PUT = withSuperadmin(async (session, req: Request) => {
  const body = await parseBody(req, aiSettingsPutSchema);
  if (!body.ok) return body.response;
  const guardada = await guardarIaPlataforma({ ...body.data,
    baseUrl: baseUrlEfectiva(body.data.provider, body.data.baseUrl) }, session.userId);
  if (!guardada) return apiError(422, "sin_token", "Pega la llave del proveedor para configurar la IA de plataforma");
  return Response.json(await ajustesIaPlataforma());
});
