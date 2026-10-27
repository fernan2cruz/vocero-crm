import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type {
  ContactSegmentDto,
  ContactTagDto,
  SegmentFilters,
  TagColor,
  TagWithCount,
} from "@/lib/contact-tags";

/** 064 — Etiquetas y segmentos. Toda consulta pasa por `scoped()`. */

function dto(t: typeof schema.contactTag.$inferSelect): ContactTagDto {
  return { id: t.id, name: t.name, color: t.color };
}

export async function listTags(organizationId: string): Promise<TagWithCount[]> {
  const db = getDb();
  const [tags, counts] = await Promise.all([
    db
      .select()
      .from(schema.contactTag)
      .where(scoped(schema.contactTag.organizationId, organizationId))
      .orderBy(asc(sql`lower(${schema.contactTag.name})`)),
    db
      .select({
        tagId: schema.contactTagLink.tagId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.contactTagLink)
      .where(scoped(schema.contactTagLink.organizationId, organizationId))
      .groupBy(schema.contactTagLink.tagId),
  ]);
  const byTag = new Map(counts.map((c) => [c.tagId, c.n]));
  return tags.map((t) => ({ ...dto(t), contacts: byTag.get(t.id) ?? 0 }));
}

/** `null` = ya existe una con ese nombre (sin importar mayúsculas). */
export async function createTag(
  organizationId: string,
  name: string,
  color: TagColor
): Promise<ContactTagDto | null> {
  const [row] = await getDb()
    .insert(schema.contactTag)
    .values({ id: newId("contactTag"), organizationId, name, color })
    .onConflictDoNothing()
    .returning();
  return row ? dto(row) : null;
}

export type UpdateTagResult = ContactTagDto | "not_found" | "duplicate";

export async function updateTag(
  organizationId: string,
  id: string,
  patch: { name?: string; color?: TagColor }
): Promise<UpdateTagResult> {
  if (Object.keys(patch).length === 0) {
    const [cur] = await getDb()
      .select()
      .from(schema.contactTag)
      .where(
        scoped(
          schema.contactTag.organizationId,
          organizationId,
          eq(schema.contactTag.id, id)
        )
      )
      .limit(1);
    return cur ? dto(cur) : "not_found";
  }
  try {
    const [row] = await getDb()
      .update(schema.contactTag)
      .set(patch)
      .where(
        scoped(
          schema.contactTag.organizationId,
          organizationId,
          eq(schema.contactTag.id, id)
        )
      )
      .returning();
    return row ? dto(row) : "not_found";
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return "duplicate";
    throw err;
  }
}

export async function deleteTag(organizationId: string, id: string) {
  const rows = await getDb()
    .delete(schema.contactTag)
    .where(
      scoped(
        schema.contactTag.organizationId,
        organizationId,
        eq(schema.contactTag.id, id)
      )
    )
    .returning({ id: schema.contactTag.id });
  return rows.length > 0;
}

/** Las etiquetas de cada contacto de la lista, en una sola consulta. */
export async function tagsByContact(
  organizationId: string,
  contactIds: string[]
): Promise<Map<string, ContactTagDto[]>> {
  const out = new Map<string, ContactTagDto[]>();
  if (contactIds.length === 0) return out;
  const rows = await getDb()
    .select({ contactId: schema.contactTagLink.contactId, tag: schema.contactTag })
    .from(schema.contactTagLink)
    .innerJoin(
      schema.contactTag,
      eq(schema.contactTag.id, schema.contactTagLink.tagId)
    )
    .where(
      scoped(
        schema.contactTagLink.organizationId,
        organizationId,
        inArray(schema.contactTagLink.contactId, contactIds)
      )
    )
    .orderBy(asc(sql`lower(${schema.contactTag.name})`));
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    list.push(dto(r.tag));
    out.set(r.contactId, list);
  }
  return out;
}

/** Los contactos que traen esa etiqueta (para filtrar ANTES del límite). */
export async function contactIdsWithTag(
  organizationId: string,
  tagId: string
): Promise<string[]> {
  const rows = await getDb()
    .select({ contactId: schema.contactTagLink.contactId })
    .from(schema.contactTagLink)
    .where(
      scoped(
        schema.contactTagLink.organizationId,
        organizationId,
        eq(schema.contactTagLink.tagId, tagId)
      )
    );
  return rows.map((r) => r.contactId);
}

/**
 * Deja al contacto con EXACTAMENTE estas etiquetas. Ignora los ids que no son
 * de la organización: un id ajeno no puede colarse por aquí.
 */
export async function setContactTags(
  organizationId: string,
  contactId: string,
  tagIds: string[]
): Promise<ContactTagDto[] | null> {
  const db = getDb();
  const [c] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  if (!c) return null;

  const validas =
    tagIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.contactTag)
          .where(
            scoped(
              schema.contactTag.organizationId,
              organizationId,
              inArray(schema.contactTag.id, tagIds)
            )
          );

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.contactTagLink)
      .where(
        scoped(
          schema.contactTagLink.organizationId,
          organizationId,
          eq(schema.contactTagLink.contactId, contactId)
        )
      );
    if (validas.length > 0) {
      await tx.insert(schema.contactTagLink).values(
        validas.map((t) => ({
          id: newId("contactTagLink"),
          organizationId,
          contactId,
          tagId: t.id,
        }))
      );
    }
  });
  return validas.map(dto).sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------------- Segmentos */

export async function listSegments(
  organizationId: string
): Promise<ContactSegmentDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.contactSegment)
    .where(scoped(schema.contactSegment.organizationId, organizationId))
    .orderBy(asc(schema.contactSegment.createdAt));
  return rows.map((s) => ({ id: s.id, name: s.name, filters: s.filters }));
}

export async function createSegment(
  organizationId: string,
  name: string,
  filters: SegmentFilters
): Promise<ContactSegmentDto> {
  const [row] = await getDb()
    .insert(schema.contactSegment)
    .values({
      id: newId("contactSegment"),
      organizationId,
      name,
      filters: filters as Record<string, string>,
    })
    .returning();
  return { id: row!.id, name: row!.name, filters: row!.filters };
}

export async function deleteSegment(organizationId: string, id: string) {
  const rows = await getDb()
    .delete(schema.contactSegment)
    .where(
      and(
        eq(schema.contactSegment.organizationId, organizationId),
        eq(schema.contactSegment.id, id)
      )
    )
    .returning({ id: schema.contactSegment.id });
  return rows.length > 0;
}
