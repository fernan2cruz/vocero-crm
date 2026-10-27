"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialogo } from "./dialogo";

export function ContrasenaTemporal({ contrasena, destinatario, onCerrar }: {
  contrasena: string; destinatario: string; onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState(false);
  return <Dialogo titulo="Contraseña temporal" onCerrar={onCerrar}>
    <div className="space-y-4">
      <p className="break-words text-sm">Cuenta: {destinatario}</p>
      <p className="text-sm font-medium">Cópiala y compártela ahora. Se muestra una sola vez y no se volverá a mostrar al cerrar este panel.</p>
      <code className="block break-all rounded-md border bg-muted p-3 text-lg select-all">{contrasena}</code>
      {error && <p role="alert" className="text-sm text-destructive">No se pudo copiar. Selecciona la contraseña y cópiala manualmente.</p>}
      <p role="status" className="text-sm text-muted-foreground">{copiado ? "Contraseña copiada" : ""}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(contrasena); setCopiado(true); setError(false); }
          catch { setError(true); }
        }}>Copiar</Button>
        <Button onClick={onCerrar}>Cerrar</Button>
      </div>
    </div>
  </Dialogo>;
}
