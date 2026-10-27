"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { libroDe } from "@/server/platform/credit";
import { formatearMicros, formatoFecha, usdAMicros } from "@/lib/platform-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialogo } from "./dialogo";
import { ErrorPlataforma, mensajeError, peticion } from "./peticion";

export type CreditoNegocioProps = {
  id: string; saldo: number; modo: "own_key" | "platform"; libro: Awaited<ReturnType<typeof libroDe>>;
};
const tipos = { grant: "Recarga", usage: "Consumo", adjust: "Ajuste", refund: "Reembolso" };

export function CreditoNegocio({ id, saldo, modo, libro }: CreditoNegocioProps) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState(modo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faltaLlave, setFaltaLlave] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [accion, setAccion] = useState<"grant" | "adjust" | null>(null);
  const ruta = `/api/platform/tenants/${encodeURIComponent(id)}`;
  return <Card className="min-w-0"><CardHeader><CardTitle>IA y crédito</CardTitle></CardHeader><CardContent className="space-y-5">
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); if (guardando) return;
      setGuardando(true); setError(null); setFaltaLlave(false); setGuardado(false);
      try { await peticion(ruta, "PATCH", { action: "set_ai_mode", aiMode: seleccion }); setGuardado(true); router.refresh(); }
      catch (e) {
        if (e instanceof ErrorPlataforma && e.code === "platform_key_missing") setFaltaLlave(true);
        else setError(mensajeError(e));
      } finally { setGuardando(false); }
    }}>
      <Label htmlFor="modo-ia">Modo de IA</Label>
      <div className="flex flex-wrap gap-2"><select id="modo-ia" value={seleccion} disabled={guardando} onChange={(e) => { setSeleccion(e.target.value as typeof modo); setGuardado(false); }} className="h-9 max-w-full rounded-md border border-input bg-card px-3 text-sm"><option value="own_key">Llave propia</option><option value="platform">Plataforma</option></select><Button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</Button></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {faltaLlave && <p role="alert" className="text-sm text-destructive">Configura primero la llave de plataforma. <Link href="/platform/ia" className="underline">Ir a IA y precios</Link></p>}
      {guardado && <p role="status" className="text-sm text-muted-foreground">Modo de IA guardado.</p>}
    </form>
    {modo === "platform" ? <div><p className="text-sm text-muted-foreground">Saldo disponible (USD)</p><p className="break-all text-3xl font-semibold tabular-nums">{formatearMicros(saldo)}</p></div> : <p className="text-sm text-muted-foreground">No se cobra: solo se mide el uso</p>}
    <div className="flex flex-wrap gap-2"><Button onClick={() => setAccion("grant")}>Recargar</Button><Button variant="outline" onClick={() => setAccion("adjust")}>Ajustar</Button></div>
    <div className="space-y-2"><h3 className="font-medium">Últimos 20 movimientos</h3>
      {!libro.length ? <p className="text-sm text-muted-foreground">Sin movimientos de crédito.</p> : <div role="region" aria-label="Libro de crédito" tabIndex={0} className="overflow-x-auto rounded-md border focus-visible:ring-2 focus-visible:ring-ring">
        <table className="w-full text-left text-sm"><caption className="sr-only">Libro de crédito en USD</caption><thead className="border-b bg-muted"><tr>{["Fecha", "Tipo", "Monto (USD)", "Saldo después (USD)", "Nota"].map((t) => <th key={t} scope="col" className="p-3 font-medium">{t}</th>)}</tr></thead>
          <tbody>{libro.map((m) => <tr key={m.id} className="border-b last:border-0"><td className="min-w-40 p-3">{formatoFecha(m.createdAt)}</td><td className="p-3">{tipos[m.kind]}</td><td className="whitespace-nowrap p-3 tabular-nums">{m.amountMicros > 0 ? "+" : ""}{formatearMicros(m.amountMicros)}</td><td className="whitespace-nowrap p-3 tabular-nums">{formatearMicros(m.balanceAfter)}</td><td className="min-w-40 whitespace-pre-wrap break-words p-3">{m.note ?? "Sin nota"}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
    {accion && <MovimientoCredito accion={accion} ruta={`${ruta}/credit`} onCerrar={() => setAccion(null)} onGuardado={() => { setAccion(null); router.refresh(); }} />}
  </CardContent></Card>;
}

function MovimientoCredito({ accion, ruta, onCerrar, onGuardado }: { accion: "grant" | "adjust"; ruta: string; onCerrar: () => void; onGuardado: () => void }) {
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const micros = usdAMicros(monto);
  const titulo = accion === "grant" ? "Recargar crédito" : "Ajustar crédito";
  return <Dialogo titulo={titulo} ocupado={ocupado} onCerrar={onCerrar}><form className="space-y-4" onSubmit={async (e) => {
    e.preventDefault(); if (ocupado) return;
    if (micros === null || micros === 0 || (accion === "grant" && micros < 0)) { setError(accion === "grant" ? "Escribe un monto positivo en USD, con hasta 6 decimales." : "Escribe un monto distinto de cero en USD, con hasta 6 decimales."); return; }
    if (nota.trim().length < 3 || nota.trim().length > 200) { setError("Escribe una nota de entre 3 y 200 caracteres."); return; }
    if (!confirmando) { setError(null); setConfirmando(true); return; }
    setOcupado(true); setError(null);
    try { await peticion(ruta, "POST", { action: accion, amountMicros: micros, note: nota.trim() }); onGuardado(); }
    catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
  }}>
    {confirmando ? <div className="space-y-2 text-sm"><p>Confirma {accion === "grant" ? "la recarga" : "el ajuste"} de <strong>{micros !== null && formatearMicros(micros)} USD</strong>.</p><p className="break-words">Monto ingresado: {monto.trim()} USD</p><p className="whitespace-pre-wrap break-words">Nota: {nota.trim()}</p><p className="text-muted-foreground">El movimiento quedará registrado en el libro de crédito.</p></div> : <>
      <div className="space-y-1.5"><Label htmlFor="credito-monto">Monto en USD</Label><Input id="credito-monto" inputMode={accion === "adjust" ? "text" : "decimal"} required value={monto} onChange={(e) => setMonto(e.target.value)} aria-describedby="credito-ayuda" /><p id="credito-ayuda" className="text-xs text-muted-foreground">Hasta 6 decimales, sin separadores de miles.{accion === "adjust" ? " Acepta montos negativos." : ""}</p></div>
      <div className="space-y-1.5"><Label htmlFor="credito-nota">Nota obligatoria</Label><Textarea id="credito-nota" required minLength={3} maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} /><p className="text-xs text-muted-foreground">Entre 3 y 200 caracteres.</p></div>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={ocupado} onClick={onCerrar}>Cancelar</Button>{confirmando && <Button type="button" variant="outline" disabled={ocupado} onClick={() => setConfirmando(false)}>Volver</Button>}<Button type="submit" disabled={ocupado}>{ocupado ? "Guardando…" : confirmando ? "Confirmar movimiento" : "Continuar"}</Button></div>
  </form></Dialogo>;
}
