import { formatearMicros, proporcion } from "@/lib/platform-ui";

export function SerieConsumo({ serie }: { serie: { dia: string; llamadas: number; costoMicros: number }[] }) {
  const max = Math.max(0, ...serie.map((d) => d.costoMicros));
  const ancho = 720, alto = 180, paso = ancho / Math.max(1, serie.length);
  return <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
    <h2 className="text-lg font-semibold">Consumo diario</h2>
    <svg viewBox="0 0 800 240" role="img" aria-labelledby="serie-titulo serie-descripcion" className="h-auto w-full">
      <title id="serie-titulo">Costo diario de IA en USD</title><desc id="serie-descripcion">Barras de costo por día UTC. Los valores exactos y las llamadas están disponibles en la tabla de consumo diario.</desc>
      <g transform="translate(65,10)">
        <path d={`M0 0 V${alto} H${ancho}`} fill="none" stroke="currentColor" className="text-muted-foreground" />
        <text x="-8" y="10" textAnchor="end" fill="currentColor" fontSize="11">{formatearMicros(max)}</text>
        <text x="-8" y={alto} textAnchor="end" fill="currentColor" fontSize="11">$0</text>
        {serie.map((d, i) => { const altura = proporcion(d.costoMicros, max) / 100 * alto;
          return <rect key={d.dia} x={i * paso + 1} y={alto - altura} width={Math.max(0.5, paso - 2)} height={altura} fill="currentColor" className="text-primary"><title>{`${d.dia}: ${formatearMicros(d.costoMicros)} USD, ${d.llamadas} llamadas`}</title></rect>;
        })}
        <text y="205" fill="currentColor" fontSize="12">{serie[0]?.dia}</text>
        <text x={ancho} y="205" textAnchor="end" fill="currentColor" fontSize="12">{serie.at(-1)?.dia}</text>
      </g>
    </svg>
    {max === 0 && <p className="text-sm text-muted-foreground">Sin costo registrado en el periodo.</p>}
    <table className="sr-only"><caption>Valores del consumo diario en UTC</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Costo USD</th><th scope="col">Llamadas</th></tr></thead>
      <tbody>{serie.map((d) => <tr key={d.dia}><th scope="row">{d.dia}</th><td>{formatearMicros(d.costoMicros)}</td><td>{d.llamadas}</td></tr>)}</tbody></table>
  </section>;
}
