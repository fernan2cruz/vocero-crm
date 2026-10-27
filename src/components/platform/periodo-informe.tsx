import { parametrosDePeriodo, type ParametrosPagina } from "@/lib/platform-ui";
import { PeriodoInvalido, resolverPeriodo, type Periodo } from "@/server/platform/periodo";
import { SelectorPeriodo } from "./selector-periodo";

export function periodoInforme(parametros: ParametrosPagina): { periodo: Periodo; error?: string } {
  try { return { periodo: resolverPeriodo(parametrosDePeriodo(parametros)) }; }
  catch (e) {
    if (!(e instanceof PeriodoInvalido)) throw e;
    return { periodo: resolverPeriodo(), error: e.message };
  }
}
export function PeriodoInforme({ periodo, error }: { periodo: Periodo; error?: string }) {
  const desde = periodo.desde.toISOString().slice(0, 10), hasta = new Date(periodo.hasta.getTime() - 1).toISOString().slice(0, 10);
  return <><SelectorPeriodo key={`${desde}/${hasta}`} desde={desde} hasta={hasta} />
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-destructive">{error}</p>}</>;
}
