"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatMoneyCents, parseMoneyToCents } from "@/lib/money";
import type { SaleDto } from "@/server/contact-sales";
import { Input } from "@/components/ui/input";

/**
 * Ventas de un contacto: lo que compró y cuántas veces. El valor del cliente
 * sale de aquí; cada cambio avisa a la lista (`onChange`) para que refresque
 * el total y la etiqueta de cliente.
 */
export function VentasPanel({
  contactId,
  onChange,
}: {
  contactId: string;
  onChange: () => void;
}) {
  const [ventas, setVentas] = useState<SaleDto[] | null>(null);
  const [moneda, setMoneda] = useState("MXN");
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/contacts/${contactId}/sales`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { sales: SaleDto[]; currency: string };
    setVentas(data.sales);
    setMoneda(data.currency);
  }, [contactId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function registrar() {
    const cents = parseMoneyToCents(monto);
    if (cents === null || cents <= 0) {
      setError("Escribe un monto mayor a cero, por ejemplo 1,250.00");
      return;
    }
    setOcupado(true);
    setError(null);
    const res = await fetch(`/api/contacts/${contactId}/sales`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountCents: cents, note: nota.trim() || null }),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      setError("No se pudo registrar la venta. Intenta de nuevo.");
      return;
    }
    setMonto("");
    setNota("");
    await cargar();
    onChange();
  }

  async function borrar(id: string) {
    await fetch(`/api/contacts/${contactId}/sales/${id}`, { method: "DELETE" }).catch(
      () => null
    );
    await cargar();
    onChange();
  }

  const total = (ventas ?? [])
    .filter((v) => v.currency === moneda)
    .reduce((s, v) => s + v.amountCents, 0);

  return (
    <div className="space-y-2" data-ventas>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Ventas</span>
        {ventas && ventas.length > 0 && (
          <span className="text-xs text-muted-foreground" data-ventas-total>
            {ventas.length} {ventas.length === 1 ? "compra" : "compras"} ·{" "}
            {formatMoneyCents(total, moneda)}
          </span>
        )}
      </div>

      {ventas && ventas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Aún no hay ventas registradas. Al registrar la primera, este contacto
          cuenta como cliente.
        </p>
      )}

      <ul className="space-y-1">
        {(ventas ?? []).map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
          >
            <span>
              <strong>{formatMoneyCents(v.amountCents, v.currency)}</strong>
              {" · "}
              {new Date(v.occurredAt).toLocaleDateString("es-MX")}
              {v.note ? ` · ${v.note}` : ""}
            </span>
            <button
              type="button"
              onClick={() => void borrar(v.id)}
              aria-label="Borrar esta venta"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          inputMode="decimal"
          placeholder={`Monto (${moneda})`}
          aria-label="Monto de la venta"
          className="h-8 w-32 text-sm"
        />
        <Input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void registrar();
            }
          }}
          maxLength={200}
          placeholder="Nota (opcional)"
          aria-label="Nota de la venta"
          className="h-8 text-sm"
        />
        <button
          type="button"
          onClick={() => void registrar()}
          disabled={!monto.trim() || ocupado}
          className="h-8 shrink-0 rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Registrar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
