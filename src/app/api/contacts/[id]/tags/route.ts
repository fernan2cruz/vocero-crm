import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { setContactTags } from "@/server/contact-tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const putSchema = z.object({ tagIds: z.array(z.string().min(1)).max(50) });

/** Reemplaza las etiquetas del contacto por las enviadas. */
export const PUT = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const tags = await setContactTags(session.organizationId, id, body.data.tagIds);
  if (!tags) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ tags });
});
