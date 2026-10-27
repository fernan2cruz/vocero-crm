import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { buscarAuditoria } from "@/server/platform/auditoria";
import { listarNegocios } from "@/server/platform/tenants";
import { auditoriaSchema } from "@/server/platform/schemas";
import { etiquetaAccion, resumenDetalle, formatoFecha, type ParametrosPagina } from "@/lib/platform-ui";
import { PeriodoInforme, periodoInforme } from "@/components/platform/periodo-informe";
import { TablaSeguridad } from "@/components/platform/tabla-seguridad";
import { FiltrosSeguridad } from "@/components/platform/filtros-seguridad";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<ParametrosPagina> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const parametros = await searchParams;
  const campo = (k: string) => parametros[k] === "" ? undefined : parametros[k];
  const filtros = auditoriaSchema.safeParse({ organizationId: campo("organizationId"), accion: campo("accion"), actorUserId: campo("actorUserId"), antes: campo("antes") });
  const { periodo, error } = periodoInforme(parametros);
  const [negocios, filas] = await Promise.all([listarNegocios(), !error && filtros.success ? buscarAuditoria({ ...periodo, ...filtros.data, antes: typeof parametros.antes === "string" ? parametros.antes : undefined, limit: 51 }) : []]);
  // Anclar el periodo resuelto evita que cambie entre páginas al cruzar medianoche.
  const consulta = new URLSearchParams({ from: periodo.desde.toISOString().slice(0, 10), to: new Date(periodo.hasta.getTime() - 1).toISOString().slice(0, 10) });
  if (filtros.success) for (const k of ["organizationId", "accion", "actorUserId"] as const) { const v = filtros.data[k]; if (v) consulta.set(k, v); }
  const exportacion = `/api/platform/audit/export?${consulta}`;
  const visibles = filas.slice(0, 50), ultima = visibles.at(-1);
  if (ultima) consulta.set("antes", `${ultima.createdAt.toISOString()}|${ultima.id}`);
  return <>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Auditoría</h1>{!error && filtros.success && <a href={exportacion} className={buttonVariants({ variant: "outline" })}>Exportar CSV</a>}</header>
    <Link href="/platform/accesos" className="text-sm text-primary underline">Ver accesos y alertas</Link>
    <PeriodoInforme periodo={periodo} error={error} />
    <FiltrosSeguridad key={JSON.stringify(parametros)} parametros={parametros} negocios={negocios} tipo="auditoria" />
    {!filtros.success && <p role="alert" className="text-destructive">Los filtros o el cursor de auditoría no son válidos.</p>}
    {!error && filtros.success && <>
      <p className="text-sm text-muted-foreground">Del más reciente al más antiguo · 50 eventos por página. El CSV incluye hasta 200 eventos con los filtros activos.</p>
      <TablaSeguridad titulo="Bitácora de auditoría" columnas={["Fecha", "Actor", "Acción", "Negocio", "Usuario afectado", "Detalle"]}>
        {visibles.map((f) => <tr key={f.id}><td>{formatoFecha(f.createdAt)}</td><td>{f.actorName ?? f.actorEmail ?? "Sistema"}</td><td>{etiquetaAccion(f.action)}</td><td>{f.organizationName ?? "Plataforma"}</td><td>{f.targetName ?? f.targetEmail ?? "Sin usuario afectado"}</td><td>{resumenDetalle(f.action, f.detail)}</td></tr>)}
        {!visibles.length && <tr><td colSpan={6}>Sin eventos de auditoría para estos filtros.</td></tr>}
      </TablaSeguridad>
      {filas.length > 50 && ultima && <Link href={`/platform/auditoria?${consulta}`} className={buttonVariants({ variant: "outline" })}>Cargar más</Link>}
    </>}
  </>;
}
