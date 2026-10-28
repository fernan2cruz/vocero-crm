import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  MAX_RECIPIENTS,
  procesarCampana,
  valoresPara,
  type CampanaDeps,
} from "@/lib/campaign";
import { countVariables, renderBody } from "@/lib/templates";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { listContacts } from "@/server/contacts-list";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { sendTemplate } from "@/server/whatsapp/templates";
import { plataformaEnabled } from "@/server/platform/flag";
import { estadoDeNegocio } from "@/server/platform/estado";
import { LimiteError, verificarDestinatarios } from "@/server/platform/limites";

/**
 * 064 — Campañas: una plantilla aprobada a un segmento, con los destinatarios
 * congelados al crearla. El envío corre en este proceso (sin colas externas,
 * constitución II) y es reanudable: solo se toman los `pending`.
 */

export type CampaignFailure = {
  ok: false;
  code:
    | "not_found"
    | "invalid"
    | "empty"
    | "too_many"
    | "limite_destinatarios"
    | "count_mismatch"
    | "bad_state"
    | "not_connected";
  message: string;
};

export type CampaignDto = {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  status: "draft" | "sending" | "done" | "cancelled";
  variables: string[];
  total: number;
  pendientes: number;
  enviados: number;
  fallidos: number;
  omitidos: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type CampaignDetailDto = CampaignDto & {
  /** Cómo le llegaría el mensaje al primer destinatario. */
  ejemplo: string | null;
  problemas: { nombre: string; estado: "failed" | "skipped"; detalle: string | null }[];
  whatsappListo: boolean;
};

/** Campañas que este proceso está enviando ahora (evita dos bucles a la vez). */
const enCurso = new Set<string>();

async function conteos(organizationId: string, ids: string[]) {
  const out = new Map<string, Record<string, number>>();
  if (ids.length === 0) return out;
  const rows = await getDb()
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      status: schema.campaignRecipient.status,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.campaignRecipient)
    .where(
      scoped(
        schema.campaignRecipient.organizationId,
        organizationId,
        inArray(schema.campaignRecipient.campaignId, ids)
      )
    )
    .groupBy(schema.campaignRecipient.campaignId, schema.campaignRecipient.status);
  for (const r of rows) {
    const m = out.get(r.campaignId) ?? {};
    m[r.status] = r.n;
    out.set(r.campaignId, m);
  }
  return out;
}

function dto(
  c: typeof schema.campaign.$inferSelect,
  templateName: string,
  n: Record<string, number> = {}
): CampaignDto {
  const pendientes = (n.pending ?? 0) + (n.sending ?? 0);
  const enviados = n.sent ?? 0;
  const fallidos = n.failed ?? 0;
  const omitidos = n.skipped ?? 0;
  return {
    id: c.id,
    name: c.name,
    templateId: c.templateId,
    templateName,
    status: c.status,
    variables: c.variables,
    total: pendientes + enviados + fallidos + omitidos,
    pendientes,
    enviados,
    fallidos,
    omitidos,
    startedAt: c.startedAt?.toISOString() ?? null,
    finishedAt: c.finishedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function crearCampana(input: {
  organizationId: string;
  userId: string;
  name: string;
  templateId: string;
  variables: string[];
  filters: Record<string, string>;
}): Promise<{ ok: true; campaign: CampaignDto } | CampaignFailure> {
  const db = getDb();
  const [tpl] = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        input.organizationId,
        eq(schema.template.id, input.templateId)
      )
    )
    .limit(1);
  if (!tpl) return { ok: false, code: "not_found", message: "Plantilla no encontrada" };
  if (tpl.status !== "approved") {
    return { ok: false, code: "invalid", message: "Solo se pueden enviar plantillas aprobadas por Meta" };
  }
  const requeridas = countVariables(tpl.body);
  if (input.variables.length !== requeridas || input.variables.some((v) => !v.trim())) {
    return {
      ok: false,
      code: "invalid",
      message:
        requeridas === 0
          ? "Esta plantilla no lleva variables"
          : `La plantilla lleva ${requeridas} ${requeridas === 1 ? "variable" : "variables"}: completa todas`,
    };
  }

  // Solo WhatsApp y con a dónde escribir; lo demás no puede recibir plantilla.
  const candidatos = await listContacts(
    input.organizationId,
    new URLSearchParams(input.filters),
    MAX_RECIPIENTS * 4
  );
  const elegibles = candidatos.filter(
    ({ row }) => row.channel === "whatsapp" && (row.phone || row.waUserId)
  );
  try { await verificarDestinatarios(input.organizationId, elegibles.length); }
  catch (e) {
    if (e instanceof LimiteError) return { ok: false, code: "limite_destinatarios", message: e.message };
    throw e;
  }
  if (elegibles.length === 0) {
    return { ok: false, code: "empty", message: "Nadie del filtro puede recibir una plantilla de WhatsApp" };
  }
  if (elegibles.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      code: "too_many",
      message: `Son ${elegibles.length} personas y el tope por campaña es ${MAX_RECIPIENTS}: acota el segmento`,
    };
  }

  const id = newId("campaign");
  await db.transaction(async (tx) => {
    await tx.insert(schema.campaign).values({
      id,
      organizationId: input.organizationId,
      name: input.name,
      templateId: tpl.id,
      variables: input.variables,
      filters: input.filters,
      createdByUserId: input.userId,
    });
    await tx.insert(schema.campaignRecipient).values(
      elegibles.map(({ row }) => ({
        id: newId("campaignRecipient"),
        organizationId: input.organizationId,
        campaignId: id,
        contactId: row.id,
      }))
    );
  });
  const [c] = await db.select().from(schema.campaign).where(eq(schema.campaign.id, id));
  const n = (await conteos(input.organizationId, [id])).get(id);
  return { ok: true, campaign: dto(c!, tpl.name, n) };
}

export async function listarCampanas(organizationId: string): Promise<CampaignDto[]> {
  const rows = await getDb()
    .select({ c: schema.campaign, templateName: schema.template.name })
    .from(schema.campaign)
    .innerJoin(schema.template, eq(schema.template.id, schema.campaign.templateId))
    .where(scoped(schema.campaign.organizationId, organizationId))
    .orderBy(desc(schema.campaign.createdAt))
    .limit(50);
  const n = await conteos(organizationId, rows.map((r) => r.c.id));
  return rows.map((r) => dto(r.c, r.templateName, n.get(r.c.id)));
}

export async function obtenerCampana(
  organizationId: string,
  id: string
): Promise<CampaignDetailDto | null> {
  const db = getDb();
  const [row] = await db
    .select({ c: schema.campaign, tpl: schema.template })
    .from(schema.campaign)
    .innerJoin(schema.template, eq(schema.template.id, schema.campaign.templateId))
    .where(scoped(schema.campaign.organizationId, organizationId, eq(schema.campaign.id, id)))
    .limit(1);
  if (!row) return null;
  const n = (await conteos(organizationId, [id])).get(id);

  const [primero] = await db
    .select({ nombre: schema.contact.name })
    .from(schema.campaignRecipient)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.campaignRecipient.contactId))
    .where(eq(schema.campaignRecipient.campaignId, id))
    .orderBy(asc(schema.campaignRecipient.createdAt))
    .limit(1);
  const ejemplo = primero
    ? renderBody(row.tpl.body, valoresPara(row.c.variables, primero.nombre).valores)
    : null;

  const problemas = await db
    .select({
      nombre: schema.contact.name,
      estado: schema.campaignRecipient.status,
      detalle: schema.campaignRecipient.detail,
    })
    .from(schema.campaignRecipient)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.campaignRecipient.contactId))
    .where(
      and(
        eq(schema.campaignRecipient.campaignId, id),
        sql`${schema.campaignRecipient.status} in ('failed','skipped')`
      )
    )
    .limit(20);

  const creds = await getCredentialsByOrg(organizationId);
  return {
    ...dto(row.c, row.tpl.name, n),
    ejemplo,
    problemas: problemas.map((p) => ({
      nombre: p.nombre,
      estado: p.estado as "failed" | "skipped",
      detalle: p.detalle,
    })),
    whatsappListo: !!creds && creds.status !== "reconnect_required",
  };
}

export async function cancelarCampana(
  organizationId: string,
  id: string
): Promise<{ ok: true } | CampaignFailure> {
  const rows = await getDb()
    .update(schema.campaign)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, id),
        sql`${schema.campaign.status} in ('draft','sending')`
      )
    )
    .returning({ id: schema.campaign.id });
  if (rows.length === 0) {
    return { ok: false, code: "bad_state", message: "Esta campaña ya terminó o no existe" };
  }
  return { ok: true };
}

/**
 * Arranca (o reanuda) el envío. `confirmCount` es lo que el dueño VIO antes de
 * confirmar: si no coincide con la lista congelada, no se envía nada.
 */
export async function enviarCampana(input: {
  organizationId: string;
  id: string;
  confirmCount: number;
}): Promise<{ ok: true } | CampaignFailure> {
  const { organizationId, id } = input;
  if (plataformaEnabled() && await estadoDeNegocio(organizationId) === "suspended") {
    return { ok: false, code: "bad_state", message: "El negocio está suspendido" };
  }
  const detalle = await obtenerCampana(organizationId, id);
  if (!detalle) return { ok: false, code: "not_found", message: "Campaña no encontrada" };
  try { await verificarDestinatarios(organizationId, detalle.total); }
  catch (e) {
    if (e instanceof LimiteError) return { ok: false, code: "limite_destinatarios", message: e.message };
    throw e;
  }
  if (detalle.status === "done" || detalle.status === "cancelled") {
    return { ok: false, code: "bad_state", message: "Esta campaña ya terminó" };
  }
  if (detalle.total !== input.confirmCount) {
    return {
      ok: false,
      code: "count_mismatch",
      message: `La lista tiene ${detalle.total} destinatarios y confirmaste ${input.confirmCount}: revisa y confirma de nuevo`,
    };
  }
  if (!detalle.whatsappListo) {
    return { ok: false, code: "not_connected", message: "Conecta o reconecta el número de WhatsApp antes de enviar" };
  }
  if (enCurso.has(id)) return { ok: true };
  enCurso.add(id);
  try {
    // La reserva local precede al primer await; la base decide entre procesos.
    const reclamadas = await getDb()
      .update(schema.campaign)
      .set({ status: "sending", startedAt: sql`coalesce(${schema.campaign.startedAt}, now())` })
      .where(scoped(schema.campaign.organizationId, organizationId,
        eq(schema.campaign.id, id), eq(schema.campaign.status, "draft")))
      .returning({ id: schema.campaign.id });
    if (!reclamadas.length) {
      enCurso.delete(id);
      return { ok: true };
    }
    void ejecutar(organizationId, id, detalle.templateId, detalle.variables)
      .catch((err) => console.error("[campaña] el envío falló:", err))
      .finally(() => enCurso.delete(id));
    return { ok: true };
  } catch (error) {
    enCurso.delete(id);
    throw error;
  }
}

async function ejecutar(
  organizationId: string,
  id: string,
  templateId: string,
  variables: string[]
) {
  const db = getDb();
  const deps: CampanaDeps = {
    tomar: async (n) => {
      const rows = await db
        .select({
          id: schema.campaignRecipient.id,
          contactId: schema.campaignRecipient.contactId,
          nombre: schema.contact.name,
        })
        .from(schema.campaignRecipient)
        .innerJoin(schema.contact, eq(schema.contact.id, schema.campaignRecipient.contactId))
        .where(
          scoped(
            schema.campaignRecipient.organizationId,
            organizationId,
            eq(schema.campaignRecipient.campaignId, id),
            eq(schema.campaignRecipient.status, "pending")
          )
        )
        .orderBy(asc(schema.campaignRecipient.createdAt))
        .limit(n);
      return rows;
    },
    enviar: async (d, valores) => {
      const reclamados = await db.update(schema.campaignRecipient).set({ status: "sending" })
        .where(scoped(schema.campaignRecipient.organizationId, organizationId,
          eq(schema.campaignRecipient.id, d.id), eq(schema.campaignRecipient.status, "pending")))
        .returning({ id: schema.campaignRecipient.id });
      if (!reclamados.length) throw Object.assign(new Error("Destinatario ya reclamado"), { code: "ya_reclamado" });
      try {
        const [existente] = await db
          .select({ id: schema.conversation.id })
          .from(schema.conversation)
          .where(
            scoped(
              schema.conversation.organizationId,
              organizationId,
              eq(schema.conversation.contactId, d.contactId),
              eq(schema.conversation.isTest, false)
            )
          )
          .limit(1);
        const conversationId =
          existente?.id ?? (await getOrCreateConversation(organizationId, d.contactId)).id;
        if (plataformaEnabled() && await estadoDeNegocio(organizationId) === "suspended") {
          await db.update(schema.campaignRecipient).set({ status: "pending", detail: "negocio_suspendido" })
            .where(scoped(schema.campaignRecipient.organizationId, organizationId,
              eq(schema.campaignRecipient.id, d.id), eq(schema.campaignRecipient.status, "sending")));
          throw Object.assign(new Error("negocio_suspendido"), { code: "negocio_suspendido" });
        }
        await sendTemplate({ organizationId, conversationId, templateId, variables: valores });
      } catch (error) {
        // Solo los rechazos previos al envío admiten reanudar; un resultado incierto no se repite.
        if ((error as { code?: string }).code && ["not_connected", "reconnect_required", "sandbox_violation", "limite_diario"].includes((error as { code: string }).code)) {
          await db.update(schema.campaignRecipient).set({ status: "pending" })
            .where(scoped(schema.campaignRecipient.organizationId, organizationId,
              eq(schema.campaignRecipient.id, d.id), eq(schema.campaignRecipient.status, "sending")));
        }
        throw error;
      }
    },
    marcar: async (rid, estado, detail) => {
      await db
        .update(schema.campaignRecipient)
        .set({ status: estado, detail, sentAt: estado === "sent" ? new Date() : null })
        .where(scoped(schema.campaignRecipient.organizationId, organizationId,
          eq(schema.campaignRecipient.id, rid), inArray(schema.campaignRecipient.status, estado === "skipped" ? ["pending"] : ["sending"])));
    },
    cancelada: async () => {
      const [c] = await db
        .select({ status: schema.campaign.status })
        .from(schema.campaign)
        .where(eq(schema.campaign.id, id))
        .limit(1);
      return !c || c.status === "cancelled";
    },
    pausa: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  const res = await procesarCampana(deps, variables);
  if (res.estado === "completa") {
    await db
      .update(schema.campaign)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(schema.campaign.id, id));
  } else if (res.estado === "interrumpida") {
    // Vuelve a borrador: los pendientes siguen ahí y se reanuda con «Enviar».
    await db.update(schema.campaign).set({ status: "draft" }).where(eq(schema.campaign.id, id));
    console.warn(`[campaña] ${id} interrumpida: ${res.motivo}`);
  }
}
