"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { urlConFiltros } from "@/lib/platform-ui";
import { ListaUsuarios, type UsuarioPortal } from "./lista-usuarios";

export function UsuariosClient({ usuarios, negocios, filtros, error }: {
  usuarios: UsuarioPortal[]; negocios: { id: string; name: string }[];
  filtros: { q?: string; organizationId?: string }; error?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filtros.q ?? "");
  const [organizationId, setOrganizationId] = useState(filtros.organizationId ?? "");
  const [pendiente, iniciar] = useTransition();
  return <>
    <header><h1 className="text-2xl font-semibold">Usuarios</h1><p className="text-sm text-muted-foreground">Cuentas y accesos de todos los negocios.</p></header>
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(evento) => {
      evento.preventDefault(); iniciar(() => router.push(urlConFiltros({ q, organizationId })));
    }}>
      <div className="space-y-1 sm:w-80"><Label htmlFor="buscar-usuario">Nombre o correo</Label><Input id="buscar-usuario" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="negocio-usuario">Negocio</Label><select id="negocio-usuario" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="block h-9 w-full max-w-full rounded-md border border-input bg-card px-3 text-sm sm:max-w-72"><option value="">Todos los negocios</option>{negocios.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
      <Button type="submit" disabled={pendiente}>{pendiente ? "Buscando…" : "Aplicar filtros"}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Se muestran hasta 200 resultados. Usa los filtros para acotar la lista. La última sesión corresponde a las sesiones que siguen registradas.</p>
    <ListaUsuarios usuarios={usuarios} global />
  </>;
}
