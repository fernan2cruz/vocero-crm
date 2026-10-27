import Link from "next/link";
import { notFound } from "next/navigation";
import { resumenPlataforma } from "@/server/platform/resumen";
import { etiquetaRiesgo, formatearMicros, proporcion, type ParametrosPagina } from "@/lib/platform-ui";
import { PeriodoInforme, periodoInforme } from "@/components/platform/periodo-informe";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";

export const dynamic = "force-dynamic";

export default async function PlatformPage({ searchParams }: { searchParams: Promise<ParametrosPagina> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const { periodo, error } = periodoInforme(await searchParams);
  const datos = error ? null : await resumenPlataforma(periodo);
  return <><h1 className="text-2xl font-semibold">Resumen</h1><PeriodoInforme periodo={periodo} error={error} />
    {datos && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
        ["Negocios", `${datos.negocios.activos} activos / ${datos.negocios.suspendidos} suspendidos`],
        ["Usuarios", datos.usuarios], ["Consumo del periodo", `${formatearMicros(datos.consumo.costoMicros)} USD · ${datos.consumo.llamadas} llamadas`],
        ["Crédito total", `${formatearMicros(datos.creditoTotalMicros)} USD`],
      ].map(([titulo, valor]) => <Card key={titulo}><CardHeader><CardTitle>{titulo}</CardTitle></CardHeader><CardContent className="break-words text-lg font-semibold">{valor}</CardContent></Card>)}</div>
      <p className="text-sm text-muted-foreground">El crédito y los riesgos reflejan el estado actual.</p>
      <Card><CardHeader><CardTitle>Negocios en riesgo</CardTitle></CardHeader><CardContent>
        {!datos.enRiesgo.length ? <p>Ningún negocio en riesgo</p> : <ul className="divide-y">{datos.enRiesgo.map((n) => <li key={n.organizationId} className="py-3">
          <Link className="flex flex-wrap items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring" href={`/platform/negocios/${encodeURIComponent(n.organizationId)}`}><span className="min-w-0 break-words font-medium underline">{n.nombre}</span>
            {n.motivos.map((m) => <Badge key={m} variant="outline">{etiquetaRiesgo(m)}</Badge>)}</Link></li>)}</ul>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Mayor consumo</CardTitle></CardHeader><CardContent>
        {!datos.topConsumo.length ? <p>Sin consumo registrado</p> : <ul className="space-y-4">{datos.topConsumo.map((n) => <li key={n.organizationId}>
          <Link href={`/platform/negocios/${encodeURIComponent(n.organizationId)}`} className="block space-y-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex flex-wrap justify-between gap-2 text-sm"><span className="min-w-0 break-words underline">{n.nombre}</span><span>{formatearMicros(n.costoMicros)} USD</span></span>
            <span aria-hidden="true" className="block h-3 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${proporcion(n.costoMicros, datos.topConsumo[0]?.costoMicros ?? 0)}%` }} /></span>
          </Link></li>)}</ul>}
      </CardContent></Card>
    </>}
  </>;
}
