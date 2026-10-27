import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * 064 — Ventas de un contacto y el valor del cliente que se deriva de ellas.
 *
 * El valor NO es un campo: se calcula del libro (`contact_sale`) cada vez, así
 * que borrar o corregir una venta lo corrige solo. Los totales solo suman lo
 * que está en la moneda del negocio (convertir exigiría un tipo de cambio, y
 * un CRM que inventa tipos de cambio miente); las ventas se cuentan todas.
 */

export type SaleDto = {
  id: string;
  amountCents: number;
  currency: string;
  note: string | null;
  occurredAt: string;
};

export type ContactValueDto = {
  /** Suma de las ventas en la moneda del negocio. */
  totalCents: number;
  currency: string;
  /** Cuántas veces compró: la recurrencia. */
  ventas: number;
  ultimaVentaAt: string | null;
};

function dto(s: typeof schema.contactSale.$inferSelect): SaleDto {
  return {
    id: s.id,
    amountCents: s.amountCents,
    currency: s.currency,
    note: s.note,
    occurredAt: s.occurredAt.toISOString(),
  };
}

export async function listSales(
  organizationId: string,
  contactId: string
): Promise<SaleDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.contactSale)
    .where(
      scoped(
        schema.contactSale.organizationId,
        organizationId,
        eq(schema.contactSale.contactId, contactId)
      )
    )
    .orderBy(desc(schema.contactSale.occurredAt));
  return rows.map(dto);
}

/** `null` = el contacto no existe en esta organización. */
export async function createSale(input: {
  organizationId: string;
  contactId: string;
  amountCents: number;
  currency: string;
  note: string | null;
  occurredAt: Date | null;
  userId: string;
}): Promise<SaleDto | null> {
  const db = getDb();
  const [c] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        eq(schema.contact.id, input.contactId)
      )
    )
    .limit(1);
  if (!c) return null;
  const [row] = await db
    .insert(schema.contactSale)
    .values({
      id: newId("contactSale"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      amountCents: input.amountCents,
      currency: input.currency,
      note: input.note,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      createdByUserId: input.userId,
    })
    .returning();
  return dto(row!);
}

export async function deleteSale(
  organizationId: string,
  contactId: string,
  saleId: string
): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.contactSale)
    .where(
      scoped(
        schema.contactSale.organizationId,
        organizationId,
        eq(schema.contactSale.contactId, contactId),
        eq(schema.contactSale.id, saleId)
      )
    )
    .returning({ id: schema.contactSale.id });
  return rows.length > 0;
}

/** El valor de cada contacto con al menos una venta (los demás no aparecen). */
export async function valorPorContacto(
  organizationId: string,
  businessCurrency: string,
  contactIds?: string[]
): Promise<Map<string, ContactValueDto>> {
  const out = new Map<string, ContactValueDto>();
  if (contactIds && contactIds.length === 0) return out;
  const rows = await getDb()
    .select({
      contactId: schema.contactSale.contactId,
      total: sql<number>`coalesce(sum(${schema.contactSale.amountCents}) filter (where ${schema.contactSale.currency} = ${businessCurrency}), 0)::int`,
      ventas: sql<number>`count(*)::int`,
      ultima: sql<Date | null>`max(${schema.contactSale.occurredAt})`,
    })
    .from(schema.contactSale)
    .where(
      scoped(
        schema.contactSale.organizationId,
        organizationId,
        contactIds ? inArray(schema.contactSale.contactId, contactIds) : undefined
      )
    )
    .groupBy(schema.contactSale.contactId);
  for (const r of rows) {
    out.set(r.contactId, {
      totalCents: r.total,
      currency: businessCurrency,
      ventas: r.ventas,
      ultimaVentaAt: r.ultima ? new Date(r.ultima).toISOString() : null,
    });
  }
  return out;
}

/** Contactos con al menos una venta: la mitad de «es cliente». */
export async function idsConVentas(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ contactId: schema.contactSale.contactId })
    .from(schema.contactSale)
    .where(scoped(schema.contactSale.organizationId, organizationId))
    .orderBy(asc(schema.contactSale.contactId));
  return rows.map((r) => r.contactId);
}
