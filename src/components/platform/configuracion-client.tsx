"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialogo } from "./dialogo";
import { ConfirmarConMotivo } from "./confirmar-con-motivo";
import { mensajeError, peticion } from "./peticion";
import type { listarConfig } from "@/server/platform/config/service";

type Fila = Awaited<ReturnType<typeof listarConfig>>[number];
export function ConfiguracionClient({ filas, iaConfigurada, webhook }: {
  filas: Fila[]; iaConfigurada: boolean; webhook: { url: string; token: string };
}) {
  const router = useRouter();
  const [editar, setEditar] = useState<Fila | null>(null);
  const [quitar, setQuitar] = useState<Fila | null>(null);
  const [aviso, setAviso] = useState("");
  const pendientes = filas.filter((f) => f.key === "META_APP_SECRET" && !f.configurado);
  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setAviso("Copiado"); }
    catch { setAviso("No se pudo copiar. Selecciona el texto y cópialo manualmente."); }
  }
  return <>
    <h1 className="text-2xl font-semibold">Configuración</h1>
    <section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Pendiente de configurar">
      <h2 className="text-lg font-semibold">Pendiente de configurar</h2>
      {!pendientes.length && iaConfigurada ? <p>No hay pendientes.</p> : <ul className="list-inside list-disc space-y-2">
        {pendientes.map((f) => <li key={f.key}>{f.etiqueta}: los webhooks de Meta responden 503 hasta configurarlo.</li>)}
        {!iaConfigurada && <li><Link href="/platform/ia" className="underline">Configurar la llave de IA de plataforma</Link></li>}
      </ul>}
    </section>
    {[...new Set(filas.map((f) => f.grupo))].map((grupo) => <section key={grupo} className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-lg font-semibold">{grupo}</h2>
      <ul className="divide-y">{filas.filter((f) => f.grupo === grupo).map((f) => <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0 flex-1 basis-60 space-y-1">
          <h3 className="font-medium">{f.etiqueta}</h3>
          <p className="break-all text-xs text-muted-foreground">{f.key}</p>
          <p className="text-sm">{!f.configurado ? "Sin configurar" : f.origen === "portal" ? "Configurado en el portal" : f.origen === "env" ? "Viene del .env" : f.origen === "autogenerado" ? "Autogenerado" : "Valor predeterminado"}
            {f.ultimos4 && ` · Configurado, termina en ${f.ultimos4}`}
            {f.tipo !== "secreto" && ` · ${Array.isArray(f.valor) ? f.valor.join(", ") : typeof f.valor === "boolean" ? f.valor ? "Sí" : "No" : f.valor}`}</p>
          <p className="text-sm text-muted-foreground">{f.ayuda}</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setEditar(f)}>Editar<span className="sr-only"> {f.etiqueta}</span></Button>
          {(f.origen === "portal" || f.origen === "autogenerado") && <Button variant="ghost" onClick={() => setQuitar(f)}>Quitar<span className="sr-only"> {f.etiqueta}</span></Button>}</div>
      </li>)}</ul>
    </section>)}
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Webhook de Meta">
      <h2 className="text-lg font-semibold">Webhook de Meta</h2>
      <p className="text-sm text-muted-foreground">Solo para el superadmin. Pega estos datos en la configuración del webhook de Meta.</p>
      {[["URL de WhatsApp", webhook.url], ["Verify token", webhook.token]].map(([nombre, texto]) => <div key={nombre} className="space-y-2">
        <p className="font-medium">{nombre}</p><p className="select-all break-all rounded border p-2 font-mono text-sm">{texto}</p>
        <Button variant="outline" onClick={() => void copiar(texto!)}>Copiar {nombre}</Button>
      </div>)}
      <p role="status" aria-live="polite">{aviso}</p>
    </section>
    {editar && <EditarConfig fila={editar} onCerrar={() => setEditar(null)} onGuardar={async (valor) => {
      await peticion(`/api/platform/config/${editar.key}`, "PUT", { valor }); setEditar(null); router.refresh();
    }} />}
    {quitar && <ConfirmarConMotivo titulo="Quitar configuración" conMotivo={false}
      descripcion={`Se quitará ${quitar.etiqueta} del portal y se usará el respaldo del .env o el valor predeterminado. Si falta el token de verificación, se generará uno nuevo: deberás actualizar Meta.`}
      onCerrar={() => setQuitar(null)} onConfirmar={async () => {
        await peticion(`/api/platform/config/${quitar.key}`, "DELETE"); setQuitar(null); router.refresh();
      }} />}
  </>;
}

export function EditarConfig({ fila, onCerrar, onGuardar }: { fila: Fila; onCerrar: () => void; onGuardar: (valor: unknown) => Promise<void> }) {
  const id = useId();
  const [valor, setValor] = useState(fila.tipo === "secreto" ? "" : Array.isArray(fila.valor) ? fila.valor.join(",") : String(fila.valor));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  return <Dialogo titulo={`Editar ${fila.etiqueta}`} ocupado={ocupado} onCerrar={onCerrar}>
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); if (ocupado) return; setOcupado(true); setError("");
      try { await onGuardar(fila.tipo === "booleano" ? valor === "true" : fila.tipo === "entero" ? Number(valor) : fila.tipo === "lista" ? valor.split(",").map((s) => s.trim()) : valor); }
      catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
    }}>
      <label htmlFor={id} className="block text-sm font-medium">{fila.etiqueta}</label>
      {fila.tipo === "booleano" ? <select id={id} value={valor} disabled={ocupado} onChange={(e) => setValor(e.target.value)} className="w-full rounded border bg-background p-2 text-foreground"><option value="true">Sí</option><option value="false">No</option></select> :
        <Input id={id} type={fila.tipo === "secreto" ? "password" : fila.tipo === "entero" ? "number" : "text"} autoComplete={fila.tipo === "secreto" ? "new-password" : "off"}
          required maxLength={4096} value={valor} disabled={ocupado} aria-describedby={`${id}-ayuda`} onChange={(e) => setValor(e.target.value)} />}
      <p id={`${id}-ayuda`} className="text-sm text-muted-foreground">{fila.ayuda}{fila.tipo === "secreto" && " Escribe un secreto nuevo para reemplazar el actual."}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={ocupado} onClick={onCerrar}>Cancelar</Button><Button disabled={ocupado} type="submit">{ocupado ? "Guardando…" : "Guardar"}</Button></div>
    </form>
  </Dialogo>;
}
