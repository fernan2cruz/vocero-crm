"use client";
import Link from "next/link";
import { useState } from "react";
import type { Productividad } from "@/server/platform/productividad";
import { formatearDuracion } from "@/lib/platform-ui";
import { formatMoneyCents } from "@/lib/money";

type Columna = "nombre" | "conversaciones" | "mensajesEntrantes" | "mensajesSalientes" | "pctAgente" | "primeraRespuestaMedianaSeg" | "traspasos" | "citas" | "realizadas" | "tratosGanados" | "ventas";
const columnas: [Columna, string][] = [["nombre", "Negocio"], ["conversaciones", "Conversaciones"], ["mensajesEntrantes", "Entrantes"], ["mensajesSalientes", "Salientes"], ["pctAgente", "% agente"], ["primeraRespuestaMedianaSeg", "Primera respuesta mediana"], ["traspasos", "Traspasos"], ["citas", "Citas"], ["realizadas", "Citas realizadas"], ["tratosGanados", "Tratos ganados"], ["ventas", "Ventas"]];

export function TablaProductividad({ negocios }: { negocios: Productividad[] }) {
  const [orden, setOrden] = useState<{ columna: Columna; asc: boolean }>({ columna: "nombre", asc: true });
  function valor(n: Productividad): string | number | null {
    if (orden.columna === "citas") return n.citas.total;
    if (orden.columna === "realizadas") return n.citas.realizadas;
    // Orden lexicográfico por moneda e importe; nunca suma monedas distintas.
    if (orden.columna === "ventas") return Object.entries(n.ventas.porMoneda).sort(([a], [b]) => a.localeCompare(b)).map(([m, c]) => `${m} ${c}`).join(" / ");
    return n[orden.columna];
  }
  const filas = [...negocios].sort((a, b) => {
    const x = valor(a), y = valor(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const resultado = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true });
    return (orden.asc ? resultado : -resultado) || a.organizationId.localeCompare(b.organizationId);
  });
  return <>
    <p className="text-sm text-muted-foreground">Periodo en UTC. El Laboratorio no cuenta. Las ventas se ordenan por moneda e importe, sin convertir monedas.</p>
    <div role="region" aria-label="Comparativa de productividad" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border bg-card focus-visible:ring-2 focus-visible:ring-ring">
      <table className="w-full text-left text-sm"><caption className="sr-only">Productividad por negocio. Pulsa un encabezado para ordenar.</caption>
        <thead className="border-b bg-muted"><tr>{columnas.map(([c, titulo]) => <th key={c} scope="col" aria-sort={orden.columna === c ? orden.asc ? "ascending" : "descending" : "none"} className="p-3 font-medium">
          <button className="rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setOrden({ columna: c, asc: orden.columna === c ? !orden.asc : true })}>{titulo}{orden.columna === c ? orden.asc ? " ↑" : " ↓" : ""}</button></th>)}</tr></thead>
        <tbody>{filas.map((n) => <tr key={n.organizationId} className="border-b last:border-0">
          <th scope="row" className="min-w-40 break-words p-3 font-medium"><Link className="underline" href={`/platform/negocios/${encodeURIComponent(n.organizationId)}`}>{n.nombre}</Link></th>
          <td className="p-3">{n.conversaciones}</td><td className="p-3">{n.mensajesEntrantes}</td><td className="p-3">{n.mensajesSalientes}</td><td className="whitespace-nowrap p-3">{n.pctAgente === null ? "—" : `${n.pctAgente.toLocaleString("es", { maximumFractionDigits: 1 })} %`}</td>
          <td className="whitespace-nowrap p-3">{formatearDuracion(n.primeraRespuestaMedianaSeg)}</td><td className="p-3">{n.traspasos}</td><td className="p-3">{n.citas.total}</td><td className="p-3">{n.citas.realizadas}</td><td className="p-3">{n.tratosGanados}</td>
          <td className="whitespace-nowrap p-3">{!Object.keys(n.ventas.porMoneda).length ? "—" : Object.entries(n.ventas.porMoneda).sort(([a], [b]) => a.localeCompare(b)).map(([moneda, centavos]) => <span key={moneda} className="block">{formatMoneyCents(centavos, moneda)} {moneda}</span>)}</td>
        </tr>)}{!filas.length && <tr><td colSpan={11} className="p-6 text-muted-foreground">Sin negocios para comparar.</td></tr>}</tbody>
      </table>
    </div>
  </>;
}
