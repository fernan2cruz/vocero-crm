import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { TAG_COLORS } from "@/lib/contact-tags";
import { deleteTag, updateTag } from "@/server/contact-tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.enum(TAG_COLORS).optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const res = await updateTag(session.organizationId, id, body.data);
  if (res === "not_found") return apiError(404, "not_found", "Etiqueta no encontrada");
  if (res === "duplicate")
    return apiError(409, "duplicate", "Ya existe una etiqueta con ese nombre");
  return Response.json({ tag: res });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const ok = await deleteTag(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Etiqueta no encontrada");
  return Response.json({ ok: true });
});
