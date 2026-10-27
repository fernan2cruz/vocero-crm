"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { obtenerNegocio } from "@/server/platform/tenants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatoFecha } from "@/lib/platform-ui";
import { InsigniaEstado } from "./insignia-estado";
import { ConfirmarConMotivo } from "./confirmar-con-motivo";
import { ListaUsuarios, type UsuarioPortal } from "./lista-usuarios";
import { mensajeError, peticion } from "./peticion";
import { CreditoNegocio, type CreditoNegocioProps } from "./credito-negocio";
import { LlaveIa, type VistaLlave } from "./llave-ia";

export function NegocioClient({ negocio, usuarios, credito, llave, informes }: {
  negocio: NonNullable<Awaited<ReturnType<typeof obtenerNegocio>>>; usuarios: UsuarioPortal[];
  credito: CreditoNegocioProps; llave: VistaLlave; informes: React.ReactNode;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [notas, setNotas] = useState(negocio.notes ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const suspendido = negocio.status === "suspended";
  const ruta = `/api/platform/tenants/${encodeURIComponent(negocio.id)}`;
  return <>
    <Link href="/platform/negocios" className="text-sm text-primary underline">Volver a negocios</Link>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3"><h1 className="break-words text-2xl font-semibold">{negocio.name}</h1><InsigniaEstado estado={negocio.status} /></div>
      <Button variant={suspendido ? "outline" : "destructive"} onClick={() => setConfirmando(true)}>{suspendido ? "Reactivar" : "Suspender"}</Button>
    </header>
    {suspendido && <section aria-label="Suspensión del negocio" className="space-y-2 rounded-xl border border-warning-soft bg-warning-tint p-4 text-warning-text">
      <h2 className="font-semibold">Negocio suspendido</h2><p className="whitespace-pre-wrap break-words text-sm">{negocio.suspendedReason ?? "Sin motivo registrado"}</p><p className="text-sm">{formatoFecha(negocio.suspendedAt)}</p>
    </section>}
    <Card><CardHeader><CardTitle>Notas internas</CardTitle></CardHeader><CardContent>
      <form className="space-y-3" onSubmit={async (evento) => {
        evento.preventDefault(); if (guardando) return;
        setGuardando(true); setError(null); setGuardado(false);
        try { await peticion(ruta, "PATCH", { notes: notas.trim() || null }); setGuardado(true); router.refresh(); }
        catch (e) { setError(mensajeError(e)); } finally { setGuardando(false); }
      }}>
        <Label htmlFor="notas-negocio">Notas de plataforma</Label>
        <Textarea id="notas-negocio" rows={4} maxLength={10000} value={notas} disabled={guardando} onChange={(e) => { setNotas(e.target.value); setGuardado(false); }} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {guardado && <p role="status" className="text-sm text-muted-foreground">Notas guardadas.</p>}
        <Button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar notas"}</Button>
      </form>
    </CardContent></Card>
    <CreditoNegocio {...credito} />
    {informes}
    <LlaveIa titulo="Llave de IA del negocio" ruta={`${ruta}/ai-key`} inicial={llave} revocable />
    <section className="space-y-3"><h2 className="text-lg font-semibold">Usuarios del negocio</h2><ListaUsuarios usuarios={usuarios} /></section>
    {confirmando && <ConfirmarConMotivo titulo={suspendido ? "Reactivar" : "Suspender"} conMotivo={!suspendido}
      descripcion={suspendido ? `Se restablecerá el acceso a ${negocio.name}.` : `Se suspenderá ${negocio.name} y se cerrarán las sesiones de sus usuarios.`}
      onCerrar={() => setConfirmando(false)} onConfirmar={async (motivo) => {
        await peticion(ruta, "PATCH", suspendido ? { action: "reactivate" } : { action: "suspend", reason: motivo });
        setConfirmando(false); router.refresh();
      }} />}
  </>;
}
