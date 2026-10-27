import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { createSale, listSales } from "@/server/contact-sales";
import { getBranding } from "@/server/branding";
import { getContactById } from "@/server/contacts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const { currency } = await getBranding(session.organizationId);
  return Response.json({
    sales: await listSales(session.organizationId, id),
    currency,
  });
});

const postSchema = z.object({
  /** Centavos enteros: el cliente convierte lo que escribió el dueño. */
  amountCents: z.number().int().positive().max(100_000_000_000),
  note: z.string().trim().max(200).nullable().optional(),
  /** Cuándo ocurrió (ISO); sin él, ahora. */
  occurredAt: z.string().datetime().optional(),
});

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  const { currency } = await getBranding(session.organizationId);
  const sale = await createSale({
    organizationId: session.organizationId,
    contactId: id,
    amountCents: body.data.amountCents,
    currency,
    note: body.data.note || null,
    occurredAt: body.data.occurredAt ? new Date(body.data.occurredAt) : null,
    userId: session.userId,
  });
  if (!sale) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ sale }, { status: 201 });
});
