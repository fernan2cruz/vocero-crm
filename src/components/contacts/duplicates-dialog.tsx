"use client";

import { useCallback, useEffect, useState } from "react";
import { DUPE_REASON_LABEL } from "@/lib/contact-dupes";
import { formatPhone } from "@/lib/utils";
import type { DuplicateGroupDto } from "@/server/contact-merge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** El que más historial tiene es el mejor candidato a quedarse. */
function principalSugerido(g: DuplicateGroupDto): string {
  const orden = [...g.contactos].sort(
    (a, b) =>
      b.mensajes + b.ventas * 100 - (a.mensajes + a.ventas * 100) ||
      a.createdAt.localeCompare(b.createdAt)
  );
  return orden[0]!.id;
}

/**
 * Contactos que parecen la misma persona. Solo del mismo canal: unir uno de
 * WhatsApp con uno de Instagram dejaría al cliente sin forma de volver a
 * reconocerse. La fusión no se puede deshacer, así que pide confirmar.
 */
export function DuplicatesDialog({
  onClose,
  onMerged,
}: {
  onClose: () => void;
  onMerged: () => void;
}) {
  const [grupos, setGrupos] = useState<DuplicateGroupDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<Record<number, string>>({});
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/contacts/duplicates").catch(() => null);
    if (!res?.ok) {
      setError("No se pudo buscar duplicados. Intenta de nuevo.");
      return;
    }
    const data = (await res.json()) as { groups: DuplicateGroupDto[] };
    setGrupos(data.groups);
    setPrincipal(Object.fromEntries(data.groups.map((g, i) => [i, principalSugerido(g)])));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function fusionar(i: number) {
    const g = grupos?.[i];
    const p = principal[i];
    if (!g || !p) return;
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/contacts/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        primaryId: p,
        duplicateIds: g.contactos.map((c) => c.id).filter((id) => id !== p),
      }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo fusionar.");
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    await cargar();
    onMerged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Contactos duplicados"
    >
      <div
        className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-duplicados
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">Contactos duplicados</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Solo se muestran contactos del mismo canal. El mismo cliente por
          WhatsApp e Instagram no se puede unir: son identidades distintas.
        </p>

        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!error && grupos === null && (
          <p className="text-sm text-muted-foreground">Buscando…</p>
        )}
        {grupos && grupos.length === 0 && (
          <p className="text-sm text-muted-foreground" data-sin-duplicados>
            No hay duplicados. Todo en orden.
          </p>
        )}

        <div className="space-y-4">
          {(grupos ?? []).map((g, i) => (
            <div key={g.contactos.map((c) => c.id).join("|")} className="rounded-lg border p-3" data-grupo>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {g.razones.map((r) => (
                  <Badge key={r} variant="secondary">
                    {DUPE_REASON_LABEL[r]}
                  </Badge>
                ))}
                {g.confianza === "media" && (
                  <span className="text-[11px] text-muted-foreground">
                    Revísalo: solo coincide el nombre
                  </span>
                )}
              </div>

              <ul className="space-y-1.5">
                {g.contactos.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-sm">
                      <input
                        type="radio"
                        name={`principal-${i}`}
                        checked={principal[i] === c.id}
                        onChange={() => {
                          setPrincipal((p) => ({ ...p, [i]: c.id }));
                          setConfirmando(null);
                        }}
                        className="mt-1 accent-primary"
                        aria-label={`Dejar a ${c.name} como principal`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatPhone(c.phone)} · {c.mensajes} mensajes
                          {c.ventas > 0 ? ` · ${c.ventas} ventas` : ""}
                          {c.tieneTrato ? " · con trato" : ""}
                        </span>
                      </span>
                      {principal[i] === c.id && <Badge variant="success">Se queda</Badge>}
                    </label>
                  </li>
                ))}
              </ul>

              {confirmando === i ? (
                <div className="mt-3 rounded-md border border-destructive/40 p-2 text-xs">
                  <p className="mb-2">
                    Se unirán {g.contactos.length} contactos en uno solo, con todos sus
                    mensajes, ventas, citas y etiquetas. Si los dos tienen trato en el
                    embudo, se conserva el del principal. <strong>No se puede deshacer.</strong>
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={ocupado} onClick={() => void fusionar(i)}>
                      {ocupado ? "Fusionando…" : "Sí, fusionar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setConfirmando(i)}
                >
                  Fusionar en el principal
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
