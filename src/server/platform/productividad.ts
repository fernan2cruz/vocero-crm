/** Productividad en días UTC: la plataforma no tiene una zona única. Solo agregados. */
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { notLabContact } from "@/server/analytics/shared";
import type { Periodo } from "./periodo";

export type Productividad = {
  organizationId: string; nombre: string; conversaciones: number; contactosNuevos: number;
  mensajesEntrantes: number; mensajesSalientes: number; pctAgente: number | null; traspasos: number;
  citas: { total: number; realizadas: number; canceladas: number; noShow: number };
  tratosGanados: number; ventas: { n: number; porMoneda: Record<string, number> };
  primeraRespuestaMedianaSeg: number | null;
};

export async function productividadPorNegocio(periodo: Periodo): Promise<Productividad[]> {
  // Cada CTE agrupa todos los negocios una vez: no se multiplican filas al unir
  // mensajes, ventas y citas ni se hace una consulta por organización.
  const filas = await getDb().execute<Productividad>(sql`
    with limites as (
      select ${periodo.desde.toISOString()}::timestamp as desde, ${periodo.hasta.toISOString()}::timestamp as hasta
    ), contactos_reales as (
      select contact.id, contact.organization_id, contact.created_at from contact
      where ${notLabContact(schema.contact.id)}
    ), mensajes as (
      select m.organization_id, count(distinct m.conversation_id)::int as conversaciones,
        count(*) filter (where m.direction = 'in')::int as entrantes,
        count(*) filter (where m.direction = 'out')::int as salientes,
        100.0 * count(*) filter (where m.direction = 'out' and m.ai_generated)
          / nullif(count(*) filter (where m.direction = 'out'), 0) as porcentaje
      from message m join conversation c on c.id = m.conversation_id and c.organization_id = m.organization_id
      cross join limites p where not c.is_test and m.created_at >= p.desde and m.created_at < p.hasta
      group by m.organization_id
    ), contactos as (
      select c.organization_id, count(*)::int as n from contactos_reales c cross join limites p
      where c.created_at >= p.desde and c.created_at < p.hasta group by c.organization_id
    ), traspasos as (
      select c.organization_id, count(*)::int as n from conversation c cross join limites p
      where not c.is_test and c.handoff_at >= p.desde and c.handoff_at < p.hasta group by c.organization_id
    ), citas as (
      select b.organization_id, jsonb_build_object('total', count(*),
        'realizadas', count(*) filter (where b.status = 'realizada'),
        'canceladas', count(*) filter (where b.status = 'cancelada'),
        'noShow', count(*) filter (where b.status = 'no_show')) as datos
      from booking b cross join limites p where b.kind = 'session' and not b.is_test
        and b.scheduled_at >= p.desde and b.scheduled_at < p.hasta group by b.organization_id
    ), ganados as (
      select e.organization_id, count(*)::int as n from lead_stage_event e
      join contactos_reales c on c.id = e.contact_id and c.organization_id = e.organization_id cross join limites p
      where e.to_stage_kind = 'won' and not e.approximate and e.occurred_at >= p.desde and e.occurred_at < p.hasta
      group by e.organization_id
    ), monedas as (
      select v.organization_id, v.currency, count(*)::int as n, sum(v.amount_cents) as centavos from contact_sale v
      join contactos_reales c on c.id = v.contact_id and c.organization_id = v.organization_id cross join limites p
      where v.occurred_at >= p.desde and v.occurred_at < p.hasta group by v.organization_id, v.currency
    ), ventas as (
      select organization_id, jsonb_build_object('n', sum(n), 'porMoneda', jsonb_object_agg(currency, centavos)) as datos
      from monedas group by organization_id
    ), primeros as (
      select m.organization_id, m.conversation_id, min(m.created_at) as entrada
      from message m join conversation c on c.id = m.conversation_id and c.organization_id = m.organization_id
      where not c.is_test and m.direction = 'in' group by m.organization_id, m.conversation_id
    ), respuestas as (
      select i.organization_id, i.conversation_id, extract(epoch from (min(m.created_at) - i.entrada)) as segundos
      from primeros i join message m on m.organization_id = i.organization_id and m.conversation_id = i.conversation_id
        and m.direction = 'out' and m.created_at > i.entrada cross join limites p
      where i.entrada >= p.desde and i.entrada < p.hasta group by i.organization_id, i.conversation_id, i.entrada
    ), medianas as (
      select organization_id, percentile_cont(0.5) within group (order by segundos)::float8 as segundos
      from respuestas group by organization_id
    )
    select o.id as "organizationId", o.name as nombre,
      coalesce(m.conversaciones, 0) as conversaciones, coalesce(c.n, 0) as "contactosNuevos",
      coalesce(m.entrantes, 0) as "mensajesEntrantes", coalesce(m.salientes, 0) as "mensajesSalientes",
      m.porcentaje::float8 as "pctAgente", coalesce(t.n, 0) as traspasos,
      coalesce(b.datos, '{"total":0,"realizadas":0,"canceladas":0,"noShow":0}'::jsonb) as citas,
      coalesce(g.n, 0) as "tratosGanados", coalesce(v.datos, '{"n":0,"porMoneda":{}}'::jsonb) as ventas,
      r.segundos as "primeraRespuestaMedianaSeg"
    from organization o left join mensajes m on m.organization_id = o.id
    left join contactos c on c.organization_id = o.id left join traspasos t on t.organization_id = o.id
    left join citas b on b.organization_id = o.id left join ganados g on g.organization_id = o.id
    left join ventas v on v.organization_id = o.id left join medianas r on r.organization_id = o.id order by o.id
  `);
  // Cohorte de respuesta: primer entrante histórico dentro del periodo; la
  // primera respuesta posterior puede caer fuera. Incluye IA y personas.
  return [...filas];
}
