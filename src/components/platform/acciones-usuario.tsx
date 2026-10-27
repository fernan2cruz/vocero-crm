"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmarConMotivo } from "./confirmar-con-motivo";
import { ContrasenaTemporal } from "./contrasena-temporal";
import { peticion } from "./peticion";

export function AccionesUsuario({ usuario }: { usuario: { id: string; name: string; email: string; disabled: boolean; esSuperadmin: boolean } }) {
  const router = useRouter();
  const [accion, setAccion] = useState<"disable" | "enable" | "reset_password" | null>(null);
  const [contrasena, setContrasena] = useState<string | null>(null);
  if (usuario.esSuperadmin) return null;
  const titulo = accion === "disable" ? "Desactivar" : accion === "enable" ? "Reactivar" : "Reiniciar contraseña";
  return <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="outline" onClick={() => setAccion(usuario.disabled ? "enable" : "disable")}>{usuario.disabled ? "Reactivar" : "Desactivar"}</Button>
    <Button size="sm" variant="ghost" onClick={() => setAccion("reset_password")}>Reiniciar contraseña</Button>
    {accion && <ConfirmarConMotivo titulo={titulo} conMotivo={accion === "disable"}
      descripcion={accion === "reset_password" ? `Se sustituirá la contraseña de ${usuario.email} y se cerrarán sus sesiones. Confirma para generar una contraseña temporal.` : `${titulo} la cuenta de ${usuario.name} (${usuario.email}).${accion === "disable" ? " Se cerrarán sus sesiones." : ""}`}
      onCerrar={() => setAccion(null)} onConfirmar={async (motivo) => {
        const datos = await peticion(`/api/platform/users/${encodeURIComponent(usuario.id)}/action`, "POST", { action: accion, ...(accion === "disable" ? { reason: motivo } : {}) });
        if (accion === "reset_password" && !datos.contrasenaTemporal) throw new Error("No se recibió la contraseña temporal.");
        setAccion(null);
        if (datos.contrasenaTemporal) setContrasena(datos.contrasenaTemporal);
        else router.refresh();
      }} />}
    {contrasena && <ContrasenaTemporal contrasena={contrasena} destinatario={usuario.email} onCerrar={() => { setContrasena(null); router.refresh(); }} />}
  </div>;
}
