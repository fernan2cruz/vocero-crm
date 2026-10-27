"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import type { listarNegocios } from "@/server/platform/tenants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { formatoFecha } from "@/lib/platform-ui";
import { InsigniaEstado } from "./insignia-estado";
import { NuevoNegocio } from "./nuevo-negocio";

export function NegociosClient({ negocios }: { negocios: Awaited<ReturnType<typeof listarNegocios>> }) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const normalizar = (valor: string) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filas = negocios.filter((n) => normalizar(n.name).includes(normalizar(busqueda.trim())) && (!estado || n.status === estado));
  return <>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Negocios</h1><p className="text-sm text-muted-foreground">Administra los negocios de la plataforma.</p></div>
      <Button onClick={() => setNuevo(true)}>Nuevo negocio</Button>
    </header>
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="space-y-1 sm:w-80"><Label htmlFor="buscar-negocio">Buscar por nombre</Label><Input id="buscar-negocio" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="estado-negocio">Estado</Label><select id="estado-negocio" value={estado} onChange={(e) => setEstado(e.target.value)} className="block h-9 w-full rounded-md border border-input bg-card px-3 text-sm"><option value="">Todos los estados</option><option value="active">Activo</option><option value="suspended">Suspendido</option></select></div>
    </div>
    {!filas.length ? <EmptyState icon={Building2} title={negocios.length ? "Sin resultados" : "Sin negocios"} description={negocios.length ? "Prueba otro nombre o estado." : "Crea el primer negocio para dar acceso a su propietario."} /> : <>
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-left text-sm"><caption className="sr-only">Negocios de la plataforma</caption>
          <thead className="border-b bg-muted"><tr>{["Nombre", "Estado", "Usuarios", "Agente", "Modo de IA", "Creado"].map((titulo) => <th key={titulo} scope="col" className="p-3 font-medium">{titulo}</th>)}</tr></thead>
          <tbody>{filas.map((n) => <tr key={n.id} onClick={() => router.push(`/platform/negocios/${encodeURIComponent(n.id)}`)} className="cursor-pointer border-b last:border-0 hover:bg-accent">
            <td className="p-3"><Link className="font-medium underline-offset-4 hover:underline" href={`/platform/negocios/${encodeURIComponent(n.id)}`}>{n.name}</Link></td>
            <td className="p-3"><InsigniaEstado estado={n.status} /></td><td className="p-3">{n.usuarios}</td><td className="p-3">{n.agenteEncendido ? "Encendido" : "Apagado"}</td><td className="p-3">{n.aiMode === "own_key" ? "Llave propia" : "Plataforma"}</td><td className="p-3">{formatoFecha(n.createdAt)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden">{filas.map((n) => <li key={n.id}><Link className="block space-y-3 rounded-xl border bg-card p-4 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" href={`/platform/negocios/${encodeURIComponent(n.id)}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words font-semibold">{n.name}</span><InsigniaEstado estado={n.status} /></div>
        <dl className="grid grid-cols-2 gap-2 text-sm"><div><dt className="text-muted-foreground">Usuarios</dt><dd>{n.usuarios}</dd></div><div><dt className="text-muted-foreground">Agente</dt><dd>{n.agenteEncendido ? "Encendido" : "Apagado"}</dd></div><div><dt className="text-muted-foreground">Modo de IA</dt><dd>{n.aiMode === "own_key" ? "Llave propia" : "Plataforma"}</dd></div><div><dt className="text-muted-foreground">Creado</dt><dd>{formatoFecha(n.createdAt)}</dd></div></dl>
      </Link></li>)}</ul>
    </>}
    {nuevo && <NuevoNegocio onCerrar={() => setNuevo(false)} />}
  </>;
}
