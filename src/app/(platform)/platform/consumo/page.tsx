import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { consumoPorNegocio, consumoPorModelo, serieDiaria } from "@/server/platform/consumo";
import { formatearMicros, parametrosDePeriodo, type ParametrosPagina } from "@/lib/platform-ui";
import { PeriodoInforme, periodoInforme } from "@/components/platform/periodo-informe";
import { SerieConsumo } from "@/components/platform/serie-consumo";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ConsumoPage({ searchParams }: { searchParams: Promise<ParametrosPagina> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const parametros = await searchParams;
  const { periodo, error } = periodoInforme(parametros);
  const organizationId = typeof parametros.organizationId === "string" ? parametros.organizationId.trim() || undefined : undefined;
  const consulta = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametrosDePeriodo(parametros))) consulta.set(clave, String(valor));
  const global = `/platform/consumo?${consulta}`;
  if (organizationId) consulta.set("organizationId", organizationId);
  const datos = error ? null : await Promise.all([consumoPorNegocio(periodo), serieDiaria(periodo, organizationId), organizationId ? consumoPorModelo(periodo, organizationId) : Promise.resolve([])]);
  const filas = datos?.[0].filter((n) => !organizationId || n.organizationId === organizationId) ?? [];
  return <>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Consumo</h1>
      {!error && <a className={buttonVariants({ variant: "outline" })} href={`/api/platform/usage/export?${consulta}`}>Exportar CSV</a>}</header>
    <PeriodoInforme periodo={periodo} error={error} />
    {datos && <>
      {organizationId && <p className="text-sm text-muted-foreground">El CSV incluye todos los negocios del periodo.</p>}
      {organizationId && <p className="text-sm">Filtro: {filas[0]?.nombre ?? "Negocio no encontrado"}. <Link className="text-primary underline" href={global}>Ver toda la plataforma</Link></p>}
      <div role="region" aria-label="Consumo por negocio" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border bg-card focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full text-left text-sm"><caption className="sr-only">Consumo por negocio ordenado por costo descendente. Importes en USD.</caption>
          <thead className="border-b bg-muted"><tr>{["Negocio", "Llamadas", "Tokens de entrada", "Tokens de salida", "Costo USD", "Agente", "Laboratorio", "Juez", "Saldo USD", "Filtro"].map((t) => <th key={t} scope="col" className="whitespace-nowrap p-3 font-medium">{t}</th>)}</tr></thead>
          <tbody>{filas.map((n) => { const filtro = new URLSearchParams(consulta); filtro.set("organizationId", n.organizationId);
            return <tr key={n.organizationId} className="border-b last:border-0">
              <th scope="row" className="min-w-40 break-words p-3 font-medium"><Link className="underline" href={`/platform/negocios/${encodeURIComponent(n.organizationId)}`}>{n.nombre}</Link></th>
              {[n.llamadas, n.tokensEntrada, n.tokensSalida, formatearMicros(n.costoMicros)].map((v, i) => <td key={i} className="p-3 tabular-nums">{v}</td>)}
              {(["bot", "lab", "judge"] as const).map((f) => <td key={f} className="whitespace-nowrap p-3"><span className="block">{formatearMicros(n.porFuente[f].costoMicros)} USD</span><span className="text-xs text-muted-foreground">{n.porFuente[f].llamadas} llamadas</span></td>)}
              <td className="whitespace-nowrap p-3">{n.saldoMicros === null ? "—" : formatearMicros(n.saldoMicros)}</td>
              <td className="p-3"><Link className="whitespace-nowrap text-primary underline" aria-label={`Ver consumo de ${n.nombre}`} href={`/platform/consumo?${filtro}`}>Ver este negocio</Link></td>
            </tr>;
          })}{!filas.length && <tr><td colSpan={10} className="p-6 text-muted-foreground">Sin negocios para este filtro.</td></tr>}</tbody>
        </table>
      </div>
      <SerieConsumo serie={datos[1]} />
      {organizationId && <section className="space-y-3"><h2 className="text-lg font-semibold">Consumo por modelo</h2>
        <div role="region" aria-label="Consumo por modelo" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border bg-card focus-visible:ring-2 focus-visible:ring-ring">
          <table className="w-full text-left text-sm"><caption className="sr-only">Consumo por modelo del negocio seleccionado</caption><thead className="border-b bg-muted"><tr>{["Modelo", "Llamadas", "Tokens de entrada", "Tokens de salida", "Costo USD"].map((t) => <th key={t} scope="col" className="p-3">{t}</th>)}</tr></thead>
            <tbody>{datos[2].map((m) => <tr key={m.model} className="border-b last:border-0"><th scope="row" className="break-all p-3 font-medium">{m.model}</th><td className="p-3">{m.llamadas}</td><td className="p-3">{m.tokensEntrada}</td><td className="p-3">{m.tokensSalida}</td><td className="p-3">{formatearMicros(m.costoMicros)}</td></tr>)}
              {!datos[2].length && <tr><td colSpan={5} className="p-6 text-muted-foreground">Sin consumo por modelo en este periodo.</td></tr>}</tbody></table>
        </div>
      </section>}
    </>}
  </>;
}
