"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { etiquetaRol } from "@/lib/platform-ui";
import { ConfirmarConMotivo } from "./confirmar-con-motivo";
import { ErrorPlataforma, peticion } from "./peticion";

export function SelectorRol({ usuario }: { usuario: { id: string; name: string; role: string | null; esSuperadmin: boolean } }) {
  const id = useId(), router = useRouter();
  const [nuevo, setNuevo] = useState<string | null>(null);
  if (usuario.esSuperadmin || !usuario.role) return <>{etiquetaRol(usuario.role)}</>;
  return <>
    <label htmlFor={id} className="sr-only">Rol de {usuario.name}</label>
    <select id={id} value={usuario.role} onChange={(e) => setNuevo(e.target.value)} className="h-9 max-w-full rounded-md border border-input bg-card px-2 text-sm">
      {!["owner", "admin", "member"].includes(usuario.role) && <option value={usuario.role}>{etiquetaRol(usuario.role)}</option>}
      <option value="owner">Propietario</option><option value="admin">Administrador</option><option value="member">Miembro</option>
    </select>
    {nuevo && <ConfirmarConMotivo titulo="Cambiar rol" conMotivo={false} descripcion={`Cambiar el rol de ${usuario.name} de ${etiquetaRol(usuario.role)} a ${etiquetaRol(nuevo)}.`} onCerrar={() => setNuevo(null)} onConfirmar={async () => {
      try { await peticion(`/api/platform/users/${encodeURIComponent(usuario.id)}/role`, "POST", { role: nuevo }); }
      catch (e) {
        if (e instanceof ErrorPlataforma) {
          const mensajes: Record<string, string> = { last_owner: "Un negocio no puede quedarse sin propietario", ambiguous_membership: "Este usuario pertenece a varios negocios. El contrato actual no permite elegir qué membresía cambiar.", is_superadmin: "No se puede cambiar el rol de un superadmin.", no_membership: "El usuario ya no tiene membresía." };
          if (mensajes[e.code]) throw new Error(mensajes[e.code]);
        }
        throw e;
      }
      setNuevo(null); router.refresh();
    }} />}
  </>;
}
