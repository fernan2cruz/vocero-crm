"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmarConMotivo } from "./confirmar-con-motivo";
import { peticion } from "./peticion";

type Accion = { action: "revoke"; sessionId: string } | { action: "revoke_user"; userId: string } | { action: "revoke_org"; organizationId: string };
export function CerrarSesiones({ accion, etiqueta, descripcion }: { accion: Accion; etiqueta: string; descripcion: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  return <div className="space-y-2">
    <Button size="sm" variant="outline" className="h-auto whitespace-normal text-left" onClick={() => setConfirmando(true)}>{etiqueta}</Button>
    {resultado && <p role="status" className="text-sm text-muted-foreground">{resultado}</p>}
    {confirmando && <ConfirmarConMotivo titulo="Cerrar sesiones" descripcion={descripcion} conMotivo={false} onCerrar={() => setConfirmando(false)} onConfirmar={async () => {
      const { n } = await peticion<{ n: number }>("/api/platform/sessions/action", "POST", accion);
      setResultado(`${n} sesiones cerradas.`); setConfirmando(false); router.refresh();
    }} />}
  </div>;
}
