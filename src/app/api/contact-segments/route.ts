import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { limpiarFiltros } from "@/lib/contact-tags";
import { createSegment, listSegments } from "@/server/contact-tags";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  return Response.json({ segments: await listSegments(session.organizationId) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: z.record(z.unknown()),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const filters = limpiarFiltros(body.data.filters);
  if (Object.keys(filters).length === 0)
    return apiError(
      422,
      "invalid_body",
      "Aplica al menos un filtro antes de guardar el segmento"
    );
  const segment = await createSegment(
    session.organizationId,
    body.data.name,
    filters
  );
  return Response.json({ segment }, { status: 201 });
});
