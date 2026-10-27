import { apiError, parseBody } from "@/lib/api";
import { proveedorPlataforma } from "@/server/platform/ai-usage";
import { probeProvider } from "@/lib/ai/probe";
import { aiProbeSchema, baseUrlEfectiva } from "@/server/ai/settings";
import { withSuperadmin } from "@/server/platform/guard";

export const POST = withSuperadmin(async (_session, req: Request) => {
  const body = await parseBody(req, aiProbeSchema);
  if (!body.ok) return body.response;
  const token = body.data.token ?? (await proveedorPlataforma())?.token;
  if (!token) return apiError(422, "sin_token", "Pega una llave para probar la conexión");
  const resultado = await probeProvider({ token, model: body.data.model,
    baseUrl: baseUrlEfectiva(body.data.provider, body.data.baseUrl) });
  // La sonda incluye texto del proveedor: podría repetir la llave. Solo devolver metadatos.
  if (!resultado.ok) return apiError(422, resultado.code, "No se pudo verificar la conexión de IA de plataforma");
  return Response.json(resultado);
});
