"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AI_PROVIDERS, AI_PROVIDER_PRESETS, AI_STATUS_LABEL, type AiProviderId, type AiStatus } from "@/lib/ai/presets";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InsigniaEstado } from "./insignia-estado";
import { ConfirmarConMotivo } from "./confirmar-con-motivo";
import { mensajeError, peticion } from "./peticion";

export type VistaLlave = {
  configurada: boolean; provider: AiProviderId | null; baseUrl: string | null;
  model: string | null; last4: string | null; estado?: AiStatus | null;
};

/** El secreto vive solo en el campo de escritura; nunca en el estado de React. */
export function LlaveIa({ titulo, ruta, inicial, revocable = false }: {
  titulo: string; ruta: string; inicial: VistaLlave; revocable?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const secreto = useRef<HTMLInputElement>(null);
  const [vista, setVista] = useState(inicial);
  const [proveedor, setProveedor] = useState<AiProviderId>(inicial.provider ?? "openrouter");
  const [baseUrl, setBaseUrl] = useState(inicial.baseUrl ?? "");
  const [modelo, setModelo] = useState(inicial.model ?? "");
  const [ocupado, setOcupado] = useState<"guardar" | "probar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [revocando, setRevocando] = useState(false);
  const preset = AI_PROVIDER_PRESETS[proveedor];

  async function ejecutar(accion: "guardar" | "probar") {
    if (ocupado) return;
    setOcupado(accion); setError(null); setMensaje(null);
    try {
      const token = secreto.current?.value.trim();
      if (!vista.configurada && !token) throw new Error("Pega la llave del proveedor.");
      if (token && (token.length < 8 || token.length > 4096)) throw new Error("La llave debe tener entre 8 y 4096 caracteres.");
      const cuerpo = { provider: proveedor, model: modelo.trim(),
        ...(proveedor === "openai_compatible" ? { baseUrl: baseUrl.trim() } : {}),
        ...(token ? { token } : {}) };
      if (accion === "guardar") {
        const guardada = await peticion<VistaLlave>(ruta, "PUT", cuerpo);
        if (secreto.current) secreto.current.value = "";
        setVista(guardada); setMensaje("Llave guardada."); router.refresh();
      } else {
        await peticion(`${ruta}/test`, "POST", cuerpo);
        setMensaje(token ? "Conexión correcta. Guarda para aplicar la llave escrita." : "Conexión correcta.");
      }
    } catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(null); }
  }

  return <Card className="min-w-0"><CardHeader><CardTitle>{titulo}</CardTitle></CardHeader><CardContent className="space-y-4">
    {vista.configurada ? <div className="space-y-2 break-words text-sm">
      <p>Configurada ••••{vista.last4} · {vista.provider ? AI_PROVIDER_PRESETS[vista.provider].label : "Sin proveedor"} · {vista.model}</p>
      {vista.estado && <div className="flex flex-wrap items-center gap-2"><InsigniaEstado estado={vista.estado === "active" ? "active" : "suspended"} /><span>{AI_STATUS_LABEL[vista.estado]}</span></div>}
    </div> : <p className="text-sm text-muted-foreground">Sin llave</p>}
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void ejecutar("guardar"); }}>
      <fieldset disabled={ocupado !== null || revocando} className="min-w-0 space-y-4">
        <legend className="sr-only">Configurar {titulo.toLowerCase()}</legend>
        <div className="space-y-1.5"><Label htmlFor={`${id}-proveedor`}>Proveedor</Label>
          <select id={`${id}-proveedor`} value={proveedor} onChange={(e) => { setProveedor(e.target.value as AiProviderId); setMensaje(null); }} className="block h-9 w-full rounded-md border border-input bg-card px-3 text-sm">
            {AI_PROVIDERS.map((p) => <option key={p} value={p}>{AI_PROVIDER_PRESETS[p].label}</option>)}
          </select>
        </div>
        {proveedor === "openai_compatible" && <div className="space-y-1.5"><Label htmlFor={`${id}-base`}>Base URL</Label><Input id={`${id}-base`} type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>}
        <div className="space-y-1.5"><Label htmlFor={`${id}-modelo`}>Modelo</Label><Input id={`${id}-modelo`} required maxLength={200} value={modelo} placeholder={preset.modelPlaceholder} onChange={(e) => setModelo(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-llave`}>Llave {vista.configurada ? "nueva (opcional)" : "del proveedor"}</Label><Input ref={secreto} id={`${id}-llave`} type="password" autoComplete="new-password" minLength={8} maxLength={4096} required={!vista.configurada} placeholder={preset.tokenPlaceholder} aria-describedby={`${id}-ayuda`} />
          <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">Solo escritura. Al guardar se vacía este campo; solo se muestran los últimos cuatro caracteres.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{ocupado === "guardar" ? "Guardando…" : "Guardar"}</Button>
          <Button type="button" variant="outline" onClick={(e) => { if (e.currentTarget.form?.reportValidity()) void ejecutar("probar"); }}>{ocupado === "probar" ? "Probando…" : "Probar conexión"}</Button>
          {revocable && vista.configurada && <Button type="button" variant="destructive" onClick={() => setRevocando(true)}>Revocar</Button>}
        </div>
      </fieldset>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {mensaje && <p role="status" className="text-sm text-muted-foreground">{mensaje}</p>}
    {revocando && <ConfirmarConMotivo titulo="Revocar llave" descripcion="Se quitará la llave de IA del negocio. Confirma para revocarla." conMotivo={false} onCerrar={() => setRevocando(false)} onConfirmar={async () => {
      const vacia = await peticion<VistaLlave>(ruta, "DELETE");
      if (secreto.current) secreto.current.value = "";
      setVista(vacia); setRevocando(false); setError(null); setMensaje("Llave revocada."); router.refresh();
    }} />}
  </CardContent></Card>;
}
