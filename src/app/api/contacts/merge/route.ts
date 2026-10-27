import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { fusionarContactos } from "@/server/contact-merge";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** El contacto que se queda. */
  primaryId: z.string().min(1),
  /** Los que se absorben y se borran. */
  duplicateIds: z.array(z.string().min(1)).min(1).max(10),
});

/**
 * Une contactos del mismo canal en uno solo. Todo o nada: una transacción.
 * No se puede deshacer, así que la pantalla pide confirmación antes de llamar.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const res = await fusionarContactos({
    organizationId: session.organizationId,
    primaryId: body.data.primaryId,
    duplicateIds: body.data.duplicateIds,
  });
  if (!res.ok) {
    const status = res.code === "not_found" ? 404 : res.code === "invalid" ? 422 : 409;
    return apiError(status, res.code, res.message);
  }
  return Response.json({ fusionados: res.fusionados, mensajesMovidos: res.mensajesMovidos });
});
