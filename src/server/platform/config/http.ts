import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { cambiarConfig, listarConfig } from "./service";
import { esClaveConfig, registroConfig } from "./registry";

export async function mutarConfig(req: Request, clave: string, actor: string, quitar = false) {
  if (!esClaveConfig(clave)) return apiError(404, "not_found", "Configuración no encontrada");
  let valor: unknown;
  if (!quitar) {
    const body = await parseBody(req, z.object({ valor: z.unknown() }));
    if (!body.ok) return body.response;
    const parsed = registroConfig[clave].validacion.safeParse(body.data.valor);
    // Zod puede repetir valores de enums: nunca devolver su error crudo.
    if (!parsed.success) return apiError(422, "invalid_body", "Valor de configuración inválido");
    valor = parsed.data;
  }
  try {
    await cambiarConfig(clave, valor, actor, quitar);
    return Response.json((await listarConfig()).find((v) => v.key === clave));
  } catch {
    return apiError(503, "config_unavailable", "No se pudo guardar la configuración");
  }
}
