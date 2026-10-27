import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { TAG_COLORS } from "@/lib/contact-tags";
import { createTag, listTags } from "@/server/contact-tags";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  return Response.json({ tags: await listTags(session.organizationId) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  // Sin `.default()`: con él, `parseBody` infiere el tipo de ENTRADA.
  color: z.enum(TAG_COLORS).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const tag = await createTag(
    session.organizationId,
    body.data.name,
    body.data.color ?? "gris"
  );
  if (!tag) return apiError(409, "duplicate", "Ya existe una etiqueta con ese nombre");
  return Response.json({ tag }, { status: 201 });
});
