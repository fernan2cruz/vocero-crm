"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialogo } from "./dialogo";
import { ContrasenaTemporal } from "./contrasena-temporal";
import { ErrorPlataforma, mensajeError, peticion } from "./peticion";

const campos = [
  ["name", "Nombre del negocio"], ["ownerName", "Nombre del propietario"],
  ["ownerEmail", "Correo del propietario"], ["tempPassword", "Contraseña temporal (opcional)"],
] as const;
type Campo = typeof campos[number][0];

export function NuevoNegocio({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const [datos, setDatos] = useState<Record<Campo, string>>({ name: "", ownerName: "", ownerEmail: "", tempPassword: "" });
  const [errores, setErrores] = useState<Partial<Record<Campo | "general", string>>>({});
  const [ocupado, setOcupado] = useState(false);
  const [creado, setCreado] = useState<{ correo: string; contrasena: string } | null>(null);
  if (creado) return <ContrasenaTemporal destinatario={creado.correo} contrasena={creado.contrasena} onCerrar={() => { setCreado(null); onCerrar(); router.refresh(); }} />;
  return <Dialogo titulo="Nuevo negocio" ocupado={ocupado} onCerrar={onCerrar}>
    <form className="space-y-4" onSubmit={async (evento) => {
      evento.preventDefault();
      if (ocupado) return;
      setOcupado(true); setErrores({});
      try {
        const respuesta = await peticion("/api/platform/tenants", "POST", {
          name: datos.name.trim(), ownerName: datos.ownerName.trim(), ownerEmail: datos.ownerEmail.trim(),
          ...(datos.tempPassword ? { tempPassword: datos.tempPassword } : {}),
        });
        if (!respuesta.contrasenaTemporal) throw new Error("No se recibió la contraseña temporal. Revisa el listado antes de repetir el alta.");
        setCreado({ correo: datos.ownerEmail.trim(), contrasena: respuesta.contrasenaTemporal });
        setDatos({ name: "", ownerName: "", ownerEmail: "", tempPassword: "" });
      } catch (e) {
        if (e instanceof ErrorPlataforma && e.code === "email_taken") setErrores({ ownerEmail: "Ya existe una cuenta con ese correo." });
        else if (e instanceof ErrorPlataforma && e.code === "invalid_body") {
          const erroresCampos: Partial<Record<Campo | "general", string>> = {};
          for (const [campo] of campos) {
            if (e.message.includes(`${campo}:`)) erroresCampos[campo] = campo === "tempPassword" ? "La contraseña debe tener entre 8 y 128 caracteres." : campo === "ownerEmail" ? "Escribe un correo válido." : "Escribe un nombre de entre 1 y 120 caracteres.";
          }
          setErrores(Object.keys(erroresCampos).length ? erroresCampos : { general: e.message });
        } else setErrores({ general: mensajeError(e) });
      } finally { setOcupado(false); }
    }}>
      {campos.map(([campo, etiqueta]) => <div key={campo} className="space-y-1.5">
        <Label htmlFor={`nuevo-${campo}`}>{etiqueta}</Label>
        <div className="flex gap-2">
          <Input id={`nuevo-${campo}`} type={campo === "ownerEmail" ? "email" : campo === "tempPassword" ? "password" : "text"}
            autoComplete={campo === "tempPassword" ? "new-password" : "off"} value={datos[campo]} disabled={ocupado}
            required={campo !== "tempPassword"} maxLength={campo === "tempPassword" ? 128 : campo === "ownerEmail" ? undefined : 120}
            minLength={campo === "tempPassword" ? 8 : 1} aria-invalid={!!errores[campo]} aria-describedby={errores[campo] ? `error-${campo}` : undefined}
            onChange={(e) => setDatos({ ...datos, [campo]: e.target.value })} />
          {campo === "tempPassword" && <Button type="button" variant="outline" disabled={ocupado} onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(20));
            const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
            setDatos({ ...datos, tempPassword: Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("") });
          }}>Generar</Button>}
        </div>
        {errores[campo] && <p id={`error-${campo}`} role="alert" className="text-sm text-destructive">{errores[campo]}</p>}
      </div>)}
      <p className="text-xs text-muted-foreground">Si dejas la contraseña vacía, se generará al crear el negocio.</p>
      {errores.general && <p role="alert" className="text-sm text-destructive">{errores.general}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={ocupado} onClick={onCerrar}>Cancelar</Button>
        <Button type="submit" disabled={ocupado}>{ocupado ? "Creando…" : "Crear negocio"}</Button>
      </div>
    </form>
  </Dialogo>;
}
