"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { etiquetaRol, formatoFecha } from "@/lib/platform-ui";
import { AccionesUsuario } from "./acciones-usuario";
import { InsigniaEstado } from "./insignia-estado";

export type UsuarioPortal = {
  id: string; name: string; email: string; role: string | null; disabled: boolean; esSuperadmin: boolean;
  organizationId?: string | null; organizationName?: string | null; ultimaSesion?: Date | string | null;
};

export function ListaUsuarios({ usuarios, global = false }: { usuarios: UsuarioPortal[]; global?: boolean }) {
  function negocio(u: UsuarioPortal) {
    return u.organizationId ? <Link className="text-primary underline" href={`/platform/negocios/${encodeURIComponent(u.organizationId)}`}>{u.organizationName}</Link> : "Sin negocio";
  }
  if (!usuarios.length) return <EmptyState icon={Users} title="Sin usuarios" description="No hay usuarios que coincidan con esta selección." />;
  return <>
    <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
      <table className="w-full text-left text-sm"><caption className="sr-only">Usuarios {global ? "de la plataforma" : "del negocio"}</caption>
        <thead className="border-b bg-muted"><tr>{["Nombre", "Correo", ...(global ? ["Negocio"] : []), "Rol", "Estado", ...(global ? ["Última sesión"] : []), "Acciones"].map((t) => <th key={t} scope="col" className="p-3 font-medium">{t}</th>)}</tr></thead>
        <tbody>{usuarios.map((u) => <tr key={`${u.id}-${u.organizationId ?? ""}`} className="border-b last:border-0">
          <td className="p-3"><span className="break-words">{u.name}</span>{u.esSuperadmin && <Badge className="mt-1">Superadmin</Badge>}</td>
          <td className="break-all p-3">{u.email}</td>{global && <td className="p-3">{negocio(u)}</td>}
          <td className="p-3">{etiquetaRol(u.role)}</td><td className="p-3"><InsigniaEstado estado={u.disabled ? "disabled" : "active"} /></td>
          {global && <td className="p-3">{formatoFecha(u.ultimaSesion ?? null)}</td>}
          <td className="p-3"><AccionesUsuario usuario={u} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="space-y-3 lg:hidden">{usuarios.map((u) => <li key={`${u.id}-${u.organizationId ?? ""}`} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2"><span className="break-words font-semibold">{u.name}</span>{u.esSuperadmin && <Badge>Superadmin</Badge>}<InsigniaEstado estado={u.disabled ? "disabled" : "active"} /></div>
      <p className="break-all text-sm text-muted-foreground">{u.email}</p>
      <dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">Rol</dt><dd>{etiquetaRol(u.role)}</dd></div>
        {global && <><div><dt className="text-muted-foreground">Negocio</dt><dd>{negocio(u)}</dd></div><div><dt className="text-muted-foreground">Última sesión</dt><dd>{formatoFecha(u.ultimaSesion ?? null)}</dd></div></>}
      </dl>
      <AccionesUsuario usuario={u} />
    </li>)}</ul>
  </>;
}
