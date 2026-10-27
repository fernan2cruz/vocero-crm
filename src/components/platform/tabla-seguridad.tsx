export function TablaSeguridad({ titulo, columnas, children }: { titulo: string; columnas: string[]; children: React.ReactNode }) {
  return <div role="region" aria-label={titulo} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border bg-card focus-visible:ring-2 focus-visible:ring-ring">
    <table className="w-full text-left text-sm"><caption className="sr-only">{titulo}</caption><thead className="border-b bg-muted"><tr>{columnas.map((c) => <th key={c} scope="col" className="whitespace-nowrap p-3 font-medium">{c}</th>)}</tr></thead><tbody className="[&_td]:p-3 [&_td]:min-w-32 [&_td]:max-w-80 [&_td]:break-words [&_tr]:border-b [&_tr:last-child]:border-0">{children}</tbody></table>
  </div>;
}
