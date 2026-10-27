"use client";

import { useEffect, useId, useRef } from "react";

/** El diálogo nativo contiene el foco y deja inerte el resto de la página. */
export function Dialogo({ titulo, ocupado = false, onCerrar, children }: {
  titulo: string; ocupado?: boolean; onCerrar: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialogo = ref.current;
    const anterior = document.activeElement;
    dialogo?.showModal();
    (dialogo?.querySelector("input, textarea, button") as HTMLElement | null)?.focus();
    return () => {
      dialogo?.close();
      if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus();
    };
  }, []);
  return <dialog ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}
    onCancel={(evento) => { evento.preventDefault(); if (!ocupado) onCerrar(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl backdrop:bg-overlay">
    <h2 id={id} className="mb-4 text-lg font-semibold">{titulo}</h2>
    {children}
  </dialog>;
}
