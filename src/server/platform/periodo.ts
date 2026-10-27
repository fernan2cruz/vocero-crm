/** Días UTC: a escala de plataforma no hay una zona horaria única. */
export type Periodo = { desde: Date; hasta: Date; dias: number };
export class PeriodoInvalido extends Error {
  constructor(mensaje = "Periodo inválido") { super(mensaje); this.name = "PeriodoInvalido"; }
}
const DIA = 86_400_000;
function fecha(valor: string): Date {
  const d = new Date(`${valor}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== valor) {
    throw new PeriodoInvalido("Las fechas deben ser válidas y tener formato AAAA-MM-DD");
  }
  return d;
}
/** to es inclusivo; omitido termina mañana UTC. Sin from, days retrocede desde hasta. */
export function resolverPeriodo({ from, to, days }: { from?: string; to?: string; days?: number } = {}): Periodo {
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 366)) {
    throw new PeriodoInvalido("days debe ser un entero entre 1 y 366");
  }
  const hoy = fecha(new Date().toISOString().slice(0, 10));
  const desdeEntrada = from === undefined ? undefined : fecha(from);
  const hasta = to !== undefined ? new Date(fecha(to).getTime() + DIA) : new Date(hoy.getTime() + DIA);
  const desde = desdeEntrada ?? new Date(hasta.getTime() - (days ?? 30) * DIA);
  const dias = (hasta.getTime() - desde.getTime()) / DIA;
  if (dias < 1 || dias > 366) throw new PeriodoInvalido("El periodo debe abarcar entre 1 y 366 días y from no puede superar to");
  return { desde, hasta, dias };
}
export function diasDelPeriodo(periodo: Periodo): string[] {
  return Array.from({ length: periodo.dias }, (_, i) => new Date(periodo.desde.getTime() + i * DIA).toISOString().slice(0, 10));
}
