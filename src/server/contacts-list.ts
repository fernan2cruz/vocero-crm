import { desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { ContactTagDto } from "@/lib/contact-tags";
import type { PriorityValue } from "@/lib/types";
import { digitsOnly, normalizeText } from "@/lib/search";
import { contactIdsWithTag, tagsByContact } from "@/server/contact-tags";
import {
  idsConVentas,
  valorPorContacto,
  type ContactValueDto,
} from "@/server/contact-sales";
import { getBranding } from "@/server/branding";

/**
 * Búsqueda tolerante en SQL, espejo de `matchesQuery` del cliente:
 * - nombre sin acentos ni mayúsculas (`translate`, sin depender de la
 *   extensión `unaccent`, que exigiría privilegios en la BD);
 * - teléfono por DÍGITOS, para poder teclearlo como se ve ("+52 555 000…").
 */
const UNACCENT_FROM = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
const UNACCENT_TO = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

export type ListedContact = {
  row: typeof schema.contact.$inferSelect;
  stageName: string | null;
  priority: PriorityValue | null;
  tags: ContactTagDto[];
  /** null = nunca ha comprado (no es lo mismo que haber comprado $0). */
  valor: ContactValueDto | null;
  /** Compró alguna vez, o su trato está en una etapa ganada. */
  esCliente: boolean;
};

/**
 * 064 — La consulta de la lista de contactos, UNA sola para la pantalla y para
 * la exportación: lo que se exporta es exactamente lo que se ve filtrado.
 *
 * Filtros (`URLSearchParams`): `q`, `stage`, `tag`, `source`, `ai=paused`,
 * `archived=true`. Todos se aplican ANTES del límite: si no, un contacto que
 * cumple el filtro podría quedar fuera por el corte.
 */
export async function listContacts(
  organizationId: string,
  params: URLSearchParams,
  limit: number
): Promise<ListedContact[]> {
  const q = params.get("q")?.trim();
  const stage = params.get("stage")?.trim();
  const includeArchived = params.get("archived") === "true";
  const tag = params.get("tag")?.trim();
  const source = params.get("source")?.trim();
  const sinAgente = params.get("ai") === "paused";
  const tipo = params.get("tipo") === "cliente" || params.get("tipo") === "prospecto"
    ? params.get("tipo")
    : null;

  const db = getDb();
  const { currency } = await getBranding(organizationId);

  // Etapa de cada contacto en una consulta aparte: una subconsulta
  // correlacionada aquí choca con el `id` de `lead` ("column reference id is
  // ambiguous"), y un join duplicaría contactos con más de un lead.
  const leadStages = await db
    .select({
      contactId: schema.lead.contactId,
      stageName: schema.pipelineStage.name,
      priority: schema.lead.priority,
      stageKind: schema.pipelineStage.kind,
    })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.pipelineStage.id, schema.lead.stageId)
    )
    .where(scoped(schema.lead.organizationId, organizationId));
  const stageByContact = new Map(
    leadStages.map((r) => [r.contactId, r.stageName])
  );
  const priorityByContact = new Map(
    leadStages.map((r) => [r.contactId, r.priority])
  );

  const qDigits = q ? digitsOnly(q) : "";
  // El patrón viaja normalizado igual que la columna, y con los comodines de
  // LIKE escapados para que un "%" tecleado no liste todo.
  const qLike = q ? normalizeText(q).replace(/[\\%_]/g, "\\$&") : "";
  const search =
    q && q.length > 0
      ? or(
          sql`lower(translate(${schema.contact.name}, ${UNACCENT_FROM}, ${UNACCENT_TO}))
              like ${`%${qLike}%`}`,
          // Un dígito suelto barrería el directorio entero: mínimo 3.
          qDigits.length >= 3
            ? sql`regexp_replace(coalesce(${schema.contact.phone}, ''), '\\D', '', 'g')
                  like ${`%${qDigits}%`}`
            : undefined
        )
      : undefined;

  const stageContactIds = stage
    ? leadStages.filter((r) => r.stageName === stage).map((r) => r.contactId)
    : null;
  if (stageContactIds?.length === 0) return [];

  const tagContactIds = tag ? await contactIdsWithTag(organizationId, tag) : null;
  if (tagContactIds?.length === 0) return [];

  // «Cliente» = compró alguna vez O su trato está en una etapa ganada.
  const conVentas = await idsConVentas(organizationId);
  const clienteIds = new Set([
    ...conVentas,
    ...leadStages.filter((r) => r.stageKind === "won").map((r) => r.contactId),
  ]);
  if (tipo === "cliente" && clienteIds.size === 0) return [];

  const sourceValida = (
    ["anuncio", "organico", "referido", "conocido", "otro"] as const
  ).find((s) => s === source);

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        search,
        includeArchived ? undefined : isNull(schema.contact.archivedAt),
        stageContactIds ? inArray(schema.contact.id, stageContactIds) : undefined,
        tagContactIds ? inArray(schema.contact.id, tagContactIds) : undefined,
        tipo === "cliente" ? inArray(schema.contact.id, [...clienteIds]) : undefined,
        tipo === "prospecto" && clienteIds.size > 0
          ? notInArray(schema.contact.id, [...clienteIds])
          : undefined,
        sourceValida ? eq(schema.contact.source, sourceValida) : undefined,
        sinAgente ? eq(schema.contact.aiPaused, true) : undefined
      )
    )
    .orderBy(desc(schema.contact.updatedAt))
    .limit(limit);

  const visibles = rows;
  const tagsPorContacto = await tagsByContact(
    organizationId,
    visibles.map((c) => c.id)
  );
  const valores = await valorPorContacto(
    organizationId,
    currency,
    visibles.map((c) => c.id)
  );
  return visibles.map((row) => ({
    row,
    stageName: stageByContact.get(row.id) ?? null,
    priority: priorityByContact.get(row.id) ?? null,
    tags: tagsPorContacto.get(row.id) ?? [],
    valor: valores.get(row.id) ?? null,
    esCliente: clienteIds.has(row.id),
  }));
}
