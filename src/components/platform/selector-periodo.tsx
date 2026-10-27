"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SelectorPeriodo({ desde, hasta }: { desde: string; hasta: string }) {
  const ruta = usePathname(), router = useRouter(), parametros = useSearchParams();
  const [from, setFrom] = useState(desde), [to, setTo] = useState(hasta);
  const [pendiente, iniciar] = useTransition();
  function aplicar(dias?: number) {
    const nuevos = new URLSearchParams(parametros.toString());
    for (const clave of ["days", "from", "to"]) nuevos.delete(clave);
    if (dias) nuevos.set("days", String(dias));
    else { nuevos.set("from", from); nuevos.set("to", to); }
    iniciar(() => router.push(`${ruta}?${nuevos}`));
  }
  return <form aria-label="Periodo del informe" aria-busy={pendiente} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); aplicar(); }}>
    <div className="flex flex-wrap gap-2">{[7, 30, 90].map((dias) => <Button key={dias} type="button" variant="outline" disabled={pendiente}
      aria-pressed={!parametros.has("from") && !parametros.has("to") && (parametros.get("days") ?? "30") === String(dias)} onClick={() => aplicar(dias)}>{dias} días</Button>)}</div>
    <div className="min-w-0 space-y-1"><Label htmlFor="periodo-desde">Desde</Label><Input id="periodo-desde" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></div>
    <div className="min-w-0 space-y-1"><Label htmlFor="periodo-hasta">Hasta</Label><Input id="periodo-hasta" type="date" required value={to} onChange={(e) => setTo(e.target.value)} /></div>
    <Button type="submit" disabled={pendiente}>Aplicar</Button><p className="w-full text-xs text-muted-foreground">Fechas inclusivas en UTC.</p>
  </form>;
}
