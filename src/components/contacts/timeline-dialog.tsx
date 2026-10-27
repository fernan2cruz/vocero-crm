"use client";

import { useEffect, useState } from "react";
import {
  TIMELINE_KINDS,
  TIMELINE_KIND_LABEL,
  type TimelineItem,
  type TimelineKind,
} from "@/lib/contact-timeline";
import { Button } from "@/components/ui/button";

const PUNTO: Record<TimelineKind, string> = {
  mensaje: "bg-blue-500",
  etapa: "bg-violet-500",
  cita: "bg-emerald-500",
  nota: "bg-amber-500",
  venta: "bg-green-600",
  alta: "bg-zinc-400",
};

function cuando(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Todo lo que le pasó al cliente, en un hilo: mensajes, etapas, citas, notas, ventas. */
export function TimelineDialog({
  contactId,
  nombre,
  onClose,
}: {
  contactId: string;
  nombre: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState(false);
  const [ocultos, setOcultos] = useState<Set<TimelineKind>>(new Set());

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/contacts/${contactId}/timeline`).catch(() => null);
      if (!res?.ok) {
        setError(true);
        return;
      }
      setItems(((await res.json()) as { items: TimelineItem[] }).items);
    })();
  }, [contactId]);

  const visibles = (items ?? []).filter((i) => !ocultos.has(i.kind));

  function alternar(k: TimelineKind) {
    setOcultos((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Historial de ${nombre}`}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-timeline
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">Historial de {nombre}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {TIMELINE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => alternar(k)}
              aria-pressed={!ocultos.has(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
                ocultos.has(k) ? "text-muted-foreground line-through" : "font-medium"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${PUNTO[k]}`} />
              {TIMELINE_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            No se pudo cargar el historial. Intenta de nuevo.
          </p>
        )}
        {!error && items === null && (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}
        {items && visibles.length === 0 && (
          <p className="text-sm text-muted-foreground">Nada que mostrar con estos filtros.</p>
        )}

        <ol className="space-y-3 border-l pl-4">
          {visibles.map((i) => (
            <li key={`${i.kind}:${i.id}`} className="relative" data-evento={i.kind}>
              <span
                className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${PUNTO[i.kind]}`}
              />
              <p className="text-sm font-medium">{i.titulo}</p>
              {i.detalle && (
                <p className="text-xs text-muted-foreground">{i.detalle}</p>
              )}
              <p className="text-[11px] text-text-3">{cuando(i.at)}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
