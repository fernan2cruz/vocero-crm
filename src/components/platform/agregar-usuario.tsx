"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialogo } from "./dialogo";
import { ContrasenaTemporal } from "./contrasena-temporal";
import { mensajeError, peticion } from "./peticion";

export function AgregarUsuario({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ correo: string; contrasena: string } | null>(null);
  const [datos, setDatos] = useState({ name: "", email: "", role: "member", tempPassword: "" });
  const cerrar = () => { setAbierto(false); setCreado(null); setError(null); setDatos({ name: "", email: "", role: "member", tempPassword: "" }); };
  return <>
    <Button onClick={() => setAbierto(true)}>Agregar usuario</Button>
    {creado ? <ContrasenaTemporal destinatario={creado.correo} contrasena={creado.contrasena} onCerrar={() => { cerrar(); router.refresh(); }} /> : abierto &&
      <Dialogo titulo="Agregar usuario" ocupado={ocupado} onCerrar={cerrar}>
        <form className="space-y-4" onSubmit={async (evento) => {
          evento.preventDefault(); if (ocupado) return;
          setOcupado(true); setError(null);
          try {
            const respuesta = await peticion("/api/platform/users", "POST", { organizationId,
              name: datos.name.trim(), email: datos.email.trim(), role: datos.role,
              ...(datos.tempPassword ? { tempPassword: datos.tempPassword } : {}),
            });
            if (!respuesta.contrasenaTemporal) throw new Error("No se recibió la contraseña temporal. Revisa el listado antes de repetir el alta.");
            setCreado({ correo: datos.email.trim(), contrasena: respuesta.contrasenaTemporal });
            setDatos({ name: "", email: "", role: "member", tempPassword: "" });
          } catch (e) { setError(mensajeError(e)); }
          finally { setOcupado(false); }
        }}>
          <div className="space-y-1.5"><Label htmlFor="usuario-nombre">Nombre</Label><Input id="usuario-nombre" required maxLength={120} value={datos.name} disabled={ocupado} onChange={(e) => setDatos({ ...datos, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="usuario-correo">Correo</Label><Input id="usuario-correo" type="email" required value={datos.email} disabled={ocupado} onChange={(e) => setDatos({ ...datos, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="usuario-rol">Rol</Label><select id="usuario-rol" className="w-full rounded-md border bg-background p-2 text-foreground" value={datos.role} disabled={ocupado} onChange={(e) => setDatos({ ...datos, role: e.target.value })}><option value="member">Miembro</option><option value="admin">Administrador</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="usuario-contrasena">Contraseña temporal (opcional)</Label><Input id="usuario-contrasena" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={datos.tempPassword} disabled={ocupado} onChange={(e) => setDatos({ ...datos, tempPassword: e.target.value })} /><p className="text-xs text-muted-foreground">Si la dejas vacía, se generará al crear el usuario.</p></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={ocupado} onClick={cerrar}>Cancelar</Button><Button type="submit" disabled={ocupado}>{ocupado ? "Creando…" : "Crear usuario"}</Button></div>
        </form>
      </Dialogo>}
  </>;
}
