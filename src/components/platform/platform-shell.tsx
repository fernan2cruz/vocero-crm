"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-mark";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { signOut } from "@/lib/auth/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function PlatformShell({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  const ruta = usePathname();
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState(false);
  return <div className="min-h-dvh bg-muted text-foreground">
    <header className="border-b-4 border-primary bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
        <BrandLogo branding={DEFAULT_BRANDING} />
        <Badge variant="outline">Plataforma</Badge>
        <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:ml-auto sm:w-auto">
          <span className="truncate text-sm" title={nombre}>{nombre}</span>
          <Button variant="outline" size="sm" disabled={saliendo} onClick={async () => {
            setSaliendo(true); setError(false);
            try {
              const resultado = await signOut();
              if (resultado.error) throw new Error();
              router.push("/login"); router.refresh();
            } catch { setError(true); setSaliendo(false); }
          }}>{saliendo ? "Cerrando…" : "Cerrar sesión"}</Button>
        </div>
        {error && <p role="alert" className="w-full text-sm text-destructive">No se pudo cerrar la sesión. Inténtalo de nuevo.</p>}
      </div>
      <nav aria-label="Portal de plataforma" className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
        {([ ["Negocios", "/platform/negocios"], ["Usuarios", "/platform/usuarios"], ["IA y precios", "/platform/ia"] ] as const).map(([etiqueta, href]) => {
          const activo = ruta === href || ruta.startsWith(`${href}/`);
          return <Link key={href} href={href} aria-current={activo ? "page" : undefined}
            className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{etiqueta}</Link>;
        })}
      </nav>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">{children}</main>
  </div>;
}
