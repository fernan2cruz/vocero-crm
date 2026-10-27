import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { textoEventoEtapa } from "@/lib/eventos-hilo";
import { formatMoneyCents } from "@/lib/money";
import {
  recortar,
  unirLinea,
  type TimelineItem,
} from "@/lib/contact-timeline";
import { getBranding } from "@/server/branding";

/** Cuántos mensajes se traen: el hilo completo vive en la Bandeja. */
const MAX_MENSAJES = 150;

const ORIGEN_SALIENTE: Record<string, string> = {
  ai: "Respondió el agente",
  operator: "Respondió una persona",
  manual: "Respondió desde el teléfono",
  template: "Se envió una plantilla",
};

const ESTADO_CITA: Record<string, string> = {
  agendada: "Cita agendada",
  realizada: "Cita realizada",
  no_show: "No asistió a la cita",
  cancelada: "Cita cancelada",
};

/**
 * 064 — Todo lo que le pasó a un cliente, en un solo hilo cronológico: sus
 * mensajes, los cambios de etapa, las citas, las notas internas y las ventas.
 * `null` si el contacto no es de la organización.
 *
 * Solo LEE. Lo del Laboratorio (conversaciones y citas de prueba) no entra:
 * no le pasó a nadie.
 */
export async function lineaDeTiempo(
  organizationId: string,
  contactId: string
): Promise<TimelineItem[] | null> {
  const db = getDb();
  const [contacto] = await db
    .select({ createdAt: schema.contact.createdAt })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  if (!contacto) return null;

  const { currency } = await getBranding(organizationId);

  const [mensajes, etapas, citas, notas, ventas] = await Promise.all([
    db
      .select({
        id: schema.message.id,
        direction: schema.message.direction,
        type: schema.message.type,
        text: schema.message.text,
        origin: schema.message.origin,
        createdAt: schema.message.createdAt,
      })
      .from(schema.message)
      .innerJoin(
        schema.conversation,
        eq(schema.message.conversationId, schema.conversation.id)
      )
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.conversation.contactId, contactId),
          eq(schema.conversation.isTest, false)
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(MAX_MENSAJES),
    db
      .select({
        id: schema.leadStageEvent.id,
        fromStageName: schema.leadStageEvent.fromStageName,
        toStageName: schema.leadStageEvent.toStageName,
        lossReason: schema.leadStageEvent.lossReason,
        source: schema.leadStageEvent.source,
        occurredAt: schema.leadStageEvent.occurredAt,
        actorNombre: schema.user.name,
      })
      .from(schema.leadStageEvent)
      .leftJoin(schema.user, eq(schema.leadStageEvent.actorUserId, schema.user.id))
      .where(
        scoped(
          schema.leadStageEvent.organizationId,
          organizationId,
          eq(schema.leadStageEvent.contactId, contactId),
          // Una fecha sembrada en una migración no se observó.
          eq(schema.leadStageEvent.approximate, false)
        )
      ),
    db
      .select()
      .from(schema.booking)
      .where(
        scoped(
          schema.booking.organizationId,
          organizationId,
          eq(schema.booking.contactId, contactId),
          eq(schema.booking.isTest, false),
          eq(schema.booking.kind, "session")
        )
      ),
    db
      .select({
        id: schema.conversationNote.id,
        texto: schema.conversationNote.texto,
        createdAt: schema.conversationNote.createdAt,
      })
      .from(schema.conversationNote)
      .innerJoin(
        schema.conversation,
        eq(schema.conversationNote.conversationId, schema.conversation.id)
      )
      .where(
        scoped(
          schema.conversationNote.organizationId,
          organizationId,
          eq(schema.conversation.contactId, contactId),
          eq(schema.conversation.isTest, false)
        )
      ),
    db
      .select()
      .from(schema.contactSale)
      .where(
        scoped(
          schema.contactSale.organizationId,
          organizationId,
          eq(schema.contactSale.contactId, contactId)
        )
      ),
  ]);

  return unirLinea([
    mensajes.map((m): TimelineItem => ({
      id: m.id,
      kind: "mensaje",
      at: m.createdAt.toISOString(),
      direccion: m.direction,
      titulo:
        m.direction === "in"
          ? "Escribió"
          : (ORIGEN_SALIENTE[m.origin] ?? "Se le respondió"),
      detalle: recortar(m.text) ?? `[${m.type}]`,
    })),
    etapas.map((e): TimelineItem => ({
      id: e.id,
      kind: "etapa",
      at: e.occurredAt.toISOString(),
      titulo: textoEventoEtapa(e),
      detalle: null,
    })),
    citas.map((c): TimelineItem => ({
      id: c.id,
      kind: "cita",
      at: c.scheduledAt.toISOString(),
      titulo: ESTADO_CITA[c.status] ?? "Cita",
      detalle: recortar(c.notes),
    })),
    notas.map((n): TimelineItem => ({
      id: n.id,
      kind: "nota",
      at: n.createdAt.toISOString(),
      titulo: "Nota interna",
      detalle: recortar(n.texto),
    })),
    ventas.map((v): TimelineItem => ({
      id: v.id,
      kind: "venta",
      at: v.occurredAt.toISOString(),
      titulo: `Venta · ${formatMoneyCents(v.amountCents, v.currency || currency)}`,
      detalle: recortar(v.note),
    })),
    [
      {
        id: contactId,
        kind: "alta",
        at: contacto.createdAt.toISOString(),
        titulo: "Contacto creado",
        detalle: null,
      },
    ],
  ]);
}
