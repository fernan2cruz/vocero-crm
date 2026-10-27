import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { limpiarFiltros } from "@/lib/contact-tags";
import { crearCampana, listarCampanas } from "@/server/campaigns";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  return Response.json({ campaigns: await listarCampanas(session.organizationId) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  templateId: z.string().min(1),
  variables: z.array(z.string().trim().max(500)).max(10),
  /** El filtro del segmento (los mismos que `GET /api/contacts`). */
  filters: z.record(z.unknown()),
});

/** Crea la campaña en borrador y CONGELA a sus destinatarios. No envía nada. */
export const POST = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo el propietario o un administrador crea campañas");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const res = await crearCampana({
    organizationId: session.organizationId,
    userId: session.userId,
    name: body.data.name,
    templateId: body.data.templateId,
    variables: body.data.variables,
    filters: limpiarFiltros(body.data.filters) as Record<string, string>,
  });
  if (!res.ok) {
    return apiError(res.code === "not_found" ? 404 : res.code === "too_many" ? 413 : 422, res.code, res.message);
  }
  return Response.json({ campaign: res.campaign }, { status: 201 });
});
