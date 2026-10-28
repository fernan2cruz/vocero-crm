"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearMicros, usdAMicros } from "@/lib/platform-ui";
import type { Limites, UsoActual } from "@/server/platform/limites";
import { mensajeError, peticion } from "./peticion";

export function LimitesNegocio({ id, limites, uso }: { id: string; limites: Limites; uso: UsoActual }) {
  const router = useRouter();
  const [mensajes, setMensajes] = useState(limites.maxMessagesPerDay?.toString() ?? "");
  const [destinatarios, setDestinatarios] = useState(limites.maxCampaignRecipients?.toString() ?? "");
  const [gasto, setGasto] = useState(() => {
    if (limites.maxMonthlySpendMicros === null) return "";
    const micros = BigInt(limites.maxMonthlySpendMicros);
    return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const entero = (texto: string) => {
    if (!texto.trim()) return null;
    const n = Number(texto);
    if (!/^\d+$/.test(texto.trim()) || !Number.isInteger(n) || n < 1 || n > 2_147_483_647) throw new Error("Escribe un entero positivo o deja el campo vacío.");
    return n;
  };
  return <Card><CardHeader><CardTitle>Límites</CardTitle></CardHeader><CardContent>
    <form className="space-y-4" aria-describedby="limites-ayuda" onChange={() => setGuardado(false)} onSubmit={async (evento) => {
      evento.preventDefault(); if (guardando) return;
      setGuardando(true); setError(null); setGuardado(false);
      try {
        const micros = gasto.trim() ? usdAMicros(gasto) : null;
        if (gasto.trim() && (micros === null || micros < 1)) throw new Error("Escribe un gasto positivo en USD con hasta seis decimales o deja el campo vacío.");
        await peticion(`/api/platform/tenants/${encodeURIComponent(id)}/limits`, "PUT", {
          maxMessagesPerDay: entero(mensajes), maxCampaignRecipients: entero(destinatarios), maxMonthlySpendMicros: micros,
        });
        setGuardado(true); router.refresh();
      } catch (e) { setError(mensajeError(e)); } finally { setGuardando(false); }
    }}>
      <p id="limites-ayuda" className="text-sm text-muted-foreground">Vacío = sin límite. El gasto de IA se limita solo con IA de plataforma.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0 space-y-2"><Label htmlFor="limite-mensajes">Mensajes salientes por día</Label>
          <Input id="limite-mensajes" inputMode="numeric" value={mensajes} onChange={(e) => setMensajes(e.target.value)} disabled={guardando} aria-describedby="uso-mensajes" />
          <p id="uso-mensajes" className="text-sm text-muted-foreground">Hoy: {uso.mensajesHoy} de {limites.maxMessagesPerDay ?? "sin límite"}</p>
        </div>
        <div className="min-w-0 space-y-2"><Label htmlFor="limite-destinatarios">Destinatarios por campaña</Label>
          <Input id="limite-destinatarios" inputMode="numeric" value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} disabled={guardando} />
        </div>
        <div className="min-w-0 space-y-2"><Label htmlFor="limite-gasto">Gasto mensual de IA (USD)</Label>
          <Input id="limite-gasto" inputMode="decimal" value={gasto} onChange={(e) => setGasto(e.target.value)} disabled={guardando} aria-describedby="uso-gasto" />
          <p id="uso-gasto" className="break-words text-sm text-muted-foreground">Mes actual (UTC): {formatearMicros(uso.gastoMesMicros)} de {limites.maxMonthlySpendMicros === null ? "sin límite" : `${formatearMicros(limites.maxMonthlySpendMicros)} USD`}</p>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {guardado && <p role="status" className="text-sm text-muted-foreground">Límites guardados.</p>}
      <Button type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar límites"}</Button>
    </form>
  </CardContent></Card>;
}
