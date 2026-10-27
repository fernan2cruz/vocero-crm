import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  claveBsuid,
  claveTelefono,
  detectarDuplicados,
  type DupeGroup,
} from "@/lib/contact-dupes";

/**
 * 064 — Duplicados y fusión de contactos.
 *
 * La fusión es de un mismo canal y se hace en UNA transacción: o queda todo
 * unido, o no se toca nada. El contacto principal absorbe lo del duplicado
 * (mensajes, notas, citas, ventas, etiquetas, ficha) y el duplicado se borra.
 */

export type DuplicateContact = {
  id: string;
  name: string;
  phone: string | null;
  channel: string;
  createdAt: string;
  mensajes: number;
  tieneTrato: boolean;
  ventas: number;
};

export type DuplicateGroupDto = Omit<DupeGroup, "ids"> & {
  contactos: DuplicateContact[];
};

export async function buscarDuplicados(
  organizationId: string
): Promise<DuplicateGroupDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, isNull(schema.contact.archivedAt)))
    .orderBy(asc(schema.contact.createdAt));

  const grupos = detectarDuplicados(
    rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      waUserId: c.waUserId,
      waIdentity: c.waIdentity,
      channel: c.channel,
      createdAt: c.createdAt.toISOString(),
    }))
  );
  if (grupos.length === 0) return [];

  const ids = grupos.flatMap((g) => g.ids);
  const [mensajes, tratos, ventas] = await Promise.all([
    db
      .select({
        contactId: schema.conversation.contactId,
        n: sql<number>`count(${schema.message.id})::int`,
      })
      .from(schema.conversation)
      .leftJoin(schema.message, eq(schema.message.conversationId, schema.conversation.id))
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          inArray(schema.conversation.contactId, ids),
          eq(schema.conversation.isTest, false)
        )
      )
      .groupBy(schema.conversation.contactId),
    db
      .select({ contactId: schema.lead.contactId })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId, inArray(schema.lead.contactId, ids))),
    db
      .select({
        contactId: schema.contactSale.contactId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.contactSale)
      .where(
        scoped(
          schema.contactSale.organizationId,
          organizationId,
          inArray(schema.contactSale.contactId, ids)
        )
      )
      .groupBy(schema.contactSale.contactId),
  ]);
  const nMsg = new Map(mensajes.map((m) => [m.contactId, m.n]));
  const conTrato = new Set(tratos.map((t) => t.contactId));
  const nVentas = new Map(ventas.map((v) => [v.contactId, v.n]));
  const porId = new Map(rows.map((c) => [c.id, c]));

  return grupos.map((g) => ({
    razones: g.razones,
    confianza: g.confianza,
    contactos: g.ids.map((id) => {
      const c = porId.get(id)!;
      return {
        id,
        name: c.name,
        phone: c.phone,
        channel: c.channel,
        createdAt: c.createdAt.toISOString(),
        mensajes: nMsg.get(id) ?? 0,
        tieneTrato: conTrato.has(id),
        ventas: nVentas.get(id) ?? 0,
      };
    }),
  }));
}

export type MergeFailure = {
  ok: false;
  code: "not_found" | "invalid" | "channel_mismatch" | "identity_conflict";
  message: string;
};
export type MergeSuccess = {
  ok: true;
  fusionados: number;
  mensajesMovidos: number;
};

/** Teléfono y BSUID que un contacto aporta, ya reducidos a claves comparables. */
function identidades(c: typeof schema.contact.$inferSelect) {
  return { tel: claveTelefono(c.phone), bsuid: claveBsuid(c) };
}

export async function fusionarContactos(input: {
  organizationId: string;
  primaryId: string;
  duplicateIds: string[];
}): Promise<MergeSuccess | MergeFailure> {
  const { organizationId, primaryId } = input;
  const duplicateIds = [...new Set(input.duplicateIds)];
  if (duplicateIds.length === 0 || duplicateIds.includes(primaryId)) {
    return { ok: false, code: "invalid", message: "Elige al menos un duplicado distinto del principal" };
  }

  return getDb().transaction(async (tx): Promise<MergeSuccess | MergeFailure> => {
    const todos = await tx
      .select()
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          inArray(schema.contact.id, [primaryId, ...duplicateIds])
        )
      )
      .for("update");
    const primary = todos.find((c) => c.id === primaryId);
    const dups = duplicateIds.map((id) => todos.find((c) => c.id === id));
    if (!primary || dups.some((d) => !d)) {
      return { ok: false, code: "not_found", message: "Algún contacto ya no existe" };
    }

    let tel = identidades(primary).tel;
    let bsuid = identidades(primary).bsuid;
    for (const d of dups as (typeof primary)[]) {
      if (d.channel !== primary.channel) {
        return {
          ok: false,
          code: "channel_mismatch",
          message:
            "Solo se pueden unir contactos del mismo canal: el mismo cliente por WhatsApp e Instagram tiene identidades que no se pueden reconciliar",
        };
      }
      const id = identidades(d);
      if ((tel && id.tel && tel !== id.tel) || (bsuid && id.bsuid && bsuid !== id.bsuid)) {
        return {
          ok: false,
          code: "identity_conflict",
          message: `«${d.name}» tiene un teléfono o identificador distinto al del principal: unirlos haría que sus mensajes futuros crearan otro contacto`,
        };
      }
      tel = tel ?? id.tel;
      bsuid = bsuid ?? id.bsuid;
    }

    const realConv = async (contactId: string) =>
      (
        await tx
          .select()
          .from(schema.conversation)
          .where(
            scoped(
              schema.conversation.organizationId,
              organizationId,
              eq(schema.conversation.contactId, contactId),
              eq(schema.conversation.isTest, false)
            )
          )
          .limit(1)
      )[0];

    let pConv = await realConv(primaryId);
    let pLead = (
      await tx
        .select()
        .from(schema.lead)
        .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, primaryId)))
        .limit(1)
    )[0];

    const patch: Partial<typeof schema.contact.$inferInsert> = {};
    let phone = primary.phone;
    let waUserId = primary.waUserId;
    let notes = primary.notes ?? "";
    let source = primary.source;
    let aiPaused = primary.aiPaused;
    const ficha: Record<string, unknown> = { ...((primary.ficha as Record<string, unknown> | null) ?? {}) };
    let mensajesMovidos = 0;

    for (const d of dups as (typeof primary)[]) {
      phone = phone ?? d.phone;
      waUserId = waUserId ?? d.waUserId ?? (d.waIdentity.startsWith("bsuid:") ? d.waIdentity.slice(6) : null);
      source = source ?? d.source;
      aiPaused = aiPaused || d.aiPaused;
      if (d.notes) notes = notes ? `${notes}\n— De «${d.name}»: ${d.notes}` : d.notes;
      for (const [k, v] of Object.entries((d.ficha as Record<string, unknown> | null) ?? {})) {
        if (!(k in ficha)) ficha[k] = v;
      }

      // Conversación: si el principal no tiene, hereda la del duplicado; si sí,
      // los mensajes y notas se pasan a la suya y la del duplicado se borra.
      const dConv = await realConv(d.id);
      if (dConv) {
        if (!pConv) {
          await tx
            .update(schema.conversation)
            .set({ contactId: primaryId, updatedAt: new Date() })
            .where(eq(schema.conversation.id, dConv.id));
          pConv = { ...dConv, contactId: primaryId };
        } else {
          const movidos = await tx
            .update(schema.message)
            .set({ conversationId: pConv.id })
            .where(eq(schema.message.conversationId, dConv.id))
            .returning({ id: schema.message.id });
          mensajesMovidos += movidos.length;
          await tx
            .update(schema.conversationNote)
            .set({ conversationId: pConv.id })
            .where(eq(schema.conversationNote.conversationId, dConv.id));
          await tx
            .update(schema.booking)
            .set({ conversationId: pConv.id })
            .where(eq(schema.booking.conversationId, dConv.id));

          // La atribución de anuncio: una por conversación.
          const yaTiene = (
            await tx
              .select({ id: schema.adAttribution.id })
              .from(schema.adAttribution)
              .where(eq(schema.adAttribution.conversationId, pConv.id))
              .limit(1)
          )[0];
          if (yaTiene) {
            await tx
              .delete(schema.adAttribution)
              .where(eq(schema.adAttribution.conversationId, dConv.id));
          } else {
            await tx
              .update(schema.adAttribution)
              .set({ contactId: primaryId, conversationId: pConv.id })
              .where(eq(schema.adAttribution.conversationId, dConv.id));
          }

          const mas = (a: Date | null, b: Date | null) =>
            a && b ? (a > b ? a : b) : (a ?? b);
          pConv = (
            await tx
              .update(schema.conversation)
              .set({
                lastMessageAt: mas(pConv.lastMessageAt, dConv.lastMessageAt),
                lastInboundAt: mas(pConv.lastInboundAt, dConv.lastInboundAt),
                unreadCount: pConv.unreadCount + dConv.unreadCount,
                aiEnabled: pConv.aiEnabled && dConv.aiEnabled,
                updatedAt: new Date(),
              })
              .where(eq(schema.conversation.id, pConv.id))
              .returning()
          )[0]!;
          await tx.delete(schema.conversation).where(eq(schema.conversation.id, dConv.id));
        }
      }
      // Atribuciones sueltas del duplicado (sin conversación movida).
      await tx
        .update(schema.adAttribution)
        .set({ contactId: primaryId })
        .where(eq(schema.adAttribution.contactId, d.id));

      // Trato: si el principal no tiene, hereda el del duplicado y su historial;
      // si ambos tienen, manda el del principal (el del duplicado se va con él).
      const dLead = (
        await tx
          .select()
          .from(schema.lead)
          .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, d.id)))
          .limit(1)
      )[0];
      if (dLead) {
        if (!pLead) {
          await tx
            .update(schema.lead)
            .set({ contactId: primaryId, updatedAt: new Date() })
            .where(eq(schema.lead.id, dLead.id));
          await tx
            .update(schema.leadStageEvent)
            .set({ contactId: primaryId })
            .where(eq(schema.leadStageEvent.leadId, dLead.id));
          pLead = { ...dLead, contactId: primaryId };
        } else {
          await tx
            .update(schema.booking)
            .set({ leadId: pLead.id })
            .where(eq(schema.booking.leadId, dLead.id));
        }
      }

      await tx
        .update(schema.booking)
        .set({ contactId: primaryId })
        .where(eq(schema.booking.contactId, d.id));
      await tx
        .update(schema.contactSale)
        .set({ contactId: primaryId })
        .where(eq(schema.contactSale.contactId, d.id));

      // Etiquetas: la unión de las dos.
      const propias = new Set(
        (
          await tx
            .select({ tagId: schema.contactTagLink.tagId })
            .from(schema.contactTagLink)
            .where(eq(schema.contactTagLink.contactId, primaryId))
        ).map((t) => t.tagId)
      );
      const ajenas = await tx
        .select({ tagId: schema.contactTagLink.tagId })
        .from(schema.contactTagLink)
        .where(eq(schema.contactTagLink.contactId, d.id));
      const nuevas = ajenas.filter((t) => !propias.has(t.tagId));
      if (nuevas.length > 0) {
        await tx.insert(schema.contactTagLink).values(
          nuevas.map((t) => ({
            id: newId("contactTagLink"),
            organizationId,
            contactId: primaryId,
            tagId: t.tagId,
          }))
        );
      }

      await tx.delete(schema.contact).where(and(eq(schema.contact.id, d.id), eq(schema.contact.organizationId, organizationId)));
    }

    // Lo que el principal adopta va DESPUÉS de borrar a los duplicados: así
    // el teléfono y el identificador que traían ya no chocan con nadie y la
    // ingesta, al reconciliar, siempre cae en el principal.
    if (phone !== primary.phone) patch.phone = phone;
    if (waUserId !== primary.waUserId) patch.waUserId = waUserId;
    if (source !== primary.source) patch.source = source;
    if (aiPaused !== primary.aiPaused) patch.aiPaused = aiPaused;
    patch.notes = notes || null;
    patch.ficha = Object.keys(ficha).length > 0 ? ficha : null;
    patch.updatedAt = new Date();
    await tx
      .update(schema.contact)
      .set(patch)
      .where(and(eq(schema.contact.id, primaryId), eq(schema.contact.organizationId, organizationId)));

    return { ok: true, fusionados: dups.length, mensajesMovidos };
  });
}
