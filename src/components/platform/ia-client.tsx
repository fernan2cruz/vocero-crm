"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { preciosDeIa } from "@/server/platform/ai-usage";
import { usdAMicros } from "@/lib/platform-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LlaveIa, type VistaLlave } from "./llave-ia";
import { mensajeError, peticion } from "./peticion";

type Precio = Awaited<ReturnType<typeof preciosDeIa>>[number];

/** Edición exacta: no usar el formato de pantalla, que redondea a centavos. */
function textoUsd(micros: number): string {
  const entero = BigInt(micros);
  return `${entero / 1_000_000n}.${(entero % 1_000_000n).toString().padStart(6, "0")}`;
}

export function IaClient({ llave, precios }: { llave: VistaLlave; precios: Precio[] }) {
  return <>
    <header><h1 className="text-2xl font-semibold">IA y precios</h1><p className="text-sm text-muted-foreground">Configura la IA de plataforma y los precios por modelo.</p></header>
    <LlaveIa titulo="Llave de plataforma" ruta="/api/platform/settings/ai" inicial={llave} />
    <Card className="min-w-0"><CardHeader><CardTitle>Precios por modelo</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Precios en USD por millón de tokens. Si un modelo no tiene precio y el proveedor no reporta un costo, su consumo cuesta 0.</p>
      <p className="text-xs text-muted-foreground">Hasta 6 decimales, sin separadores de miles. Cada fila se guarda por separado.</p>
      <div role="region" aria-label="Precios por modelo" tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full text-left text-sm"><caption className="sr-only">Precios en USD por millón de tokens</caption><thead className="border-b bg-muted"><tr>{["Modelo", "Entrada (USD/millón)", "Salida (USD/millón)", "Acción"].map((t) => <th key={t} scope="col" className="p-3 font-medium">{t}</th>)}</tr></thead>
          <tbody>{precios.map((p) => <FilaPrecio key={`${p.model}-${p.inputPerMillionMicros}-${p.outputPerMillionMicros}`} precio={p} />)}<FilaPrecio key="nuevo" /></tbody>
        </table>
      </div>
      {!precios.length && <p className="text-sm text-muted-foreground">Sin precios configurados. Añade el primer modelo en la fila de alta.</p>}
    </CardContent></Card>
  </>;
}

function FilaPrecio({ precio }: { precio?: Precio }) {
  const id = useId();
  const router = useRouter();
  const [modelo, setModelo] = useState(precio?.model ?? "");
  const [entrada, setEntrada] = useState(precio ? textoUsd(precio.inputPerMillionMicros) : "");
  const [salida, setSalida] = useState(precio ? textoUsd(precio.outputPerMillionMicros) : "");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  function cambiar() { setGuardado(false); setError(null); }
  return <tr className="border-b align-top last:border-0">
    <td className="min-w-52 p-3"><Label htmlFor={`${id}-modelo`} className="sr-only">{precio ? "Modelo" : "Nuevo modelo"}</Label><Input id={`${id}-modelo`} form={id} required maxLength={200} readOnly={!!precio} value={modelo} disabled={ocupado} placeholder="Nuevo modelo" onChange={(e) => { setModelo(e.target.value); cambiar(); }} /></td>
    <td className="min-w-40 p-3"><Label htmlFor={`${id}-entrada`} className="sr-only">Entrada en USD por millón de tokens de {precio?.model ?? "nuevo modelo"}</Label><Input id={`${id}-entrada`} form={id} required inputMode="decimal" value={entrada} disabled={ocupado} onChange={(e) => { setEntrada(e.target.value); cambiar(); }} /></td>
    <td className="min-w-40 p-3"><Label htmlFor={`${id}-salida`} className="sr-only">Salida en USD por millón de tokens de {precio?.model ?? "nuevo modelo"}</Label><Input id={`${id}-salida`} form={id} required inputMode="decimal" value={salida} disabled={ocupado} onChange={(e) => { setSalida(e.target.value); cambiar(); }} /></td>
    <td className="min-w-48 p-3"><form id={id} className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); if (ocupado) return;
      const inputPerMillionMicros = usdAMicros(entrada);
      const outputPerMillionMicros = usdAMicros(salida);
      if (!modelo.trim() || inputPerMillionMicros === null || outputPerMillionMicros === null || inputPerMillionMicros < 0 || outputPerMillionMicros < 0) { setError("Escribe un modelo y precios válidos no negativos, con hasta 6 decimales."); return; }
      setOcupado(true); setError(null); setGuardado(false);
      try {
        await peticion("/api/platform/ai/prices", "PUT", { model: modelo.trim(), inputPerMillionMicros, outputPerMillionMicros });
        if (!precio) { setModelo(""); setEntrada(""); setSalida(""); }
        setGuardado(true); router.refresh();
      } catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
    }}><Button type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : precio ? "Guardar precio" : "Añadir precio"}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{guardado && <p role="status" className="text-sm text-muted-foreground">Precio guardado.</p>}
    </form></td>
  </tr>;
}
