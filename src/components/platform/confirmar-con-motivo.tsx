"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { validarMotivo } from "@/lib/platform-ui";
import { Dialogo } from "./dialogo";
import { mensajeError } from "./peticion";

export function ConfirmarConMotivo({ titulo, descripcion, conMotivo = true, onConfirmar, onCerrar }: {
  titulo: string; descripcion: string; conMotivo?: boolean;
  onConfirmar: (motivo: string) => Promise<void>; onCerrar: () => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalido = conMotivo ? validarMotivo(motivo) : null;
  return <Dialogo titulo={titulo} ocupado={ocupado} onCerrar={onCerrar}>
    <form className="space-y-4" onSubmit={async (evento) => {
      evento.preventDefault();
      if (ocupado || invalido) { setError(invalido); return; }
      setOcupado(true); setError(null);
      try { await onConfirmar(motivo.trim()); } catch (e) { setError(mensajeError(e)); }
      finally { setOcupado(false); }
    }}>
      <p className="text-sm text-muted-foreground">{descripcion}</p>
      {conMotivo && <div className="space-y-2">
        <Label htmlFor={id}>Motivo</Label>
        <Textarea id={id} value={motivo} disabled={ocupado} maxLength={300} aria-describedby={`${id}-ayuda`} onChange={(e) => setMotivo(e.target.value)} />
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">{motivo.trim().length}/300 caracteres · Mínimo 3</p>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={ocupado} onClick={onCerrar}>Cancelar</Button>
        <Button type="submit" disabled={ocupado || !!invalido}>{ocupado ? "Guardando…" : titulo}</Button>
      </div>
    </form>
  </Dialogo>;
}
