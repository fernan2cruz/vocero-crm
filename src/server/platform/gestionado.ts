import { apiError, parseBody } from "@/lib/api";
import { probeProvider } from "@/lib/ai/probe";
import { AiCredentialError, deleteAiCredential, getAiCredentialPublic, saveAiCredential } from "@/server/ai/credentials";
import { aiProbeSchema, aiSettingsPutSchema, baseUrlEfectiva, llaveParaProbar, vistaLlaveIa } from "@/server/ai/settings";
import { auditar } from "@/server/platform/audit";
import { plataformaEnabled } from "@/server/platform/flag";
import { obtenerNegocio } from "@/server/platform/tenants";

/** La política se resuelve antes de auth y del cuerpo: no necesita consultar datos. */
export function gestionadoPorPlataforma(): Response | null {
  return plataformaEnabled()
    ? apiError(403, "gestionado_por_plataforma", "Esto lo administra la plataforma")
    : null;
}

// S-6: el portal cruza organizaciones solo desde este dominio, con id explícito.
export async function leerLlaveNegocio(organizationId: string): Promise<Response> {
  if (!(await obtenerNegocio(organizationId))) return apiError(404, "not_found", "Negocio no encontrado");
  return Response.json(vistaLlaveIa(await getAiCredentialPublic(organizationId)));
}

export async function guardarLlaveNegocio(organizationId: string, actorUserId: string, req: Request): Promise<Response> {
  if (!(await obtenerNegocio(organizationId))) return apiError(404, "not_found", "Negocio no encontrado");
  const body = await parseBody(req, aiSettingsPutSchema);
  if (!body.ok) return body.response;
  try {
    const cred = await saveAiCredential({ organizationId, ...body.data,
      baseUrl: baseUrlEfectiva(body.data.provider, body.data.baseUrl) });
    await auditar({ actorUserId, action: "ai_key.set", organizationId,
      targetUserId: null, detail: { scope: "org", provider: cred.provider, model: cred.model, last4: cred.tokenLast4 } });
    return Response.json(vistaLlaveIa(cred));
  } catch (error) {
    if (error instanceof AiCredentialError) return apiError(422, error.code, error.message);
    // El guard registra excepciones: no entregarle errores del driver con valores de entrada.
    throw new Error("No se pudo guardar la llave de IA del negocio");
  }
}

export async function revocarLlaveNegocio(organizationId: string, actorUserId: string): Promise<Response> {
  if (!(await obtenerNegocio(organizationId))) return apiError(404, "not_found", "Negocio no encontrado");
  await deleteAiCredential(organizationId);
  await auditar({ actorUserId, action: "ai_key.revoke", organizationId,
    targetUserId: null, detail: { scope: "org" } });
  return Response.json(vistaLlaveIa(null));
}

export async function probarLlaveNegocio(organizationId: string, req: Request): Promise<Response> {
  if (!(await obtenerNegocio(organizationId))) return apiError(404, "not_found", "Negocio no encontrado");
  const body = await parseBody(req, aiProbeSchema);
  if (!body.ok) return body.response;
  const llave = await llaveParaProbar(organizationId, body.data.token);
  if (!llave) return apiError(422, "sin_token", "No hay una llave para probar la conexión");
  const result = await probeProvider({ baseUrl: baseUrlEfectiva(body.data.provider, body.data.baseUrl),
    model: body.data.model, token: llave.token });
  if (!result.ok) {
    const status = ["unreachable", "timeout", "provider_error"].includes(result.code) ? 503 : 422;
    // El proveedor puede repetir la llave en su mensaje de error: no devolver ese texto.
    return apiError(status, result.code, "No se pudo verificar la conexión con el proveedor de IA");
  }
  return Response.json({ ok: true, latencyMs: result.latencyMs });
}
