import { withAuth } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { listContacts } from "@/server/contacts-list";

export const dynamic = "force-dynamic";

/** Tope de la exportación: de sobra para un negocio, y acota la memoria. */
const MAX_EXPORT = 20000;

const HEADER = [
  "Nombre",
  "Teléfono",
  "Canal",
  "Etapa",
  "Prioridad",
  "Fuente",
  "Etiquetas",
  "Sin agente",
  "Cliente",
  "Compras",
  "Total comprado",
  "Moneda",
  "Última compra",
  "Notas",
  "Creado",
];

/**
 * Exporta los contactos con los MISMOS filtros que la lista (`q`, `stage`,
 * `tag`, `source`, `ai`, `archived`): lo que se ve filtrado es lo que se baja.
 */
export const GET = withAuth(async (session, req: Request) => {
  const params = new URL(req.url).searchParams;
  const items = await listContacts(session.organizationId, params, MAX_EXPORT);

  const csv = toCsv(
    HEADER,
    items.map(({ row, stageName, priority, tags, valor, esCliente }) => [
      row.name,
      row.phone,
      row.channel,
      stageName,
      priority,
      row.source,
      tags.map((t) => t.name).join("; "),
      row.aiPaused ? "Sí" : "No",
      esCliente ? "Sí" : "No",
      valor?.ventas ?? 0,
      // En pesos (no centavos) y como número: la hoja puede sumarlo.
      valor ? valor.totalCents / 100 : 0,
      valor?.currency ?? null,
      valor?.ultimaVentaAt ?? null,
      row.notes,
      row.createdAt.toISOString(),
    ])
  );

  const dia = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contactos-${dia}.csv"`,
      "cache-control": "no-store",
    },
  });
});
