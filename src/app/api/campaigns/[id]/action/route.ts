import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { cancelarCampana, enviarCampana } from "@/server/campaigns";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("action", [
  /** `confirmCount`: a cuántas personas creyó enviar quien confirmó. */
  z.object({ action: z.literal("send"), confirmCount: z.number().int().positive() }),
  z.object({ action: z.literal("cancel") }),
]);

/**
 * Enviar o cancelar. Enviar exige confirmar el número de destinatarios: es la
 * última barrera contra mandar a una lista distinta de la que se revisó.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo el propietario o un administrador envía campañas");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const res =
    body.data.action === "send"
      ? await enviarCampana({
          organizationId: session.organizationId,
          id,
          confirmCount: body.data.confirmCount,
        })
      : await cancelarCampana(session.organizationId, id);
  if (!res.ok) {
    return apiError(res.code === "not_found" ? 404 : res.code === "limite_destinatarios" ? 422 : 409, res.code, res.message);
  }
  return Response.json({ ok: true });
});
