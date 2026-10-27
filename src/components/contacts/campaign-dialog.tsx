"use client";

import { useCallback, useEffect, useState } from "react";
import { countVariables } from "@/lib/templates";
import type { TemplateDto } from "@/lib/types";
import type { SegmentFilters } from "@/lib/contact-tags";
import type { CampaignDetailDto } from "@/server/campaigns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ESTADO: Record<CampaignDetailDto["status"], string> = {
  draft: "Borrador",
  sending: "Enviando…",
  done: "Terminada",
  cancelled: "Cancelada",
};

async function mensajeDeError(res: Response | null, porDefecto: string) {
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? porDefecto;
}

/**
 * Una campaña: una plantilla aprobada enviada al filtro que tienes puesto.
 * Tres pasos —armar, revisar y confirmar, enviar— porque escribirle a mucha
 * gente de golpe no se puede deshacer: la lista se congela al crear el
 * borrador y el envío exige confirmar a cuántas personas va.
 */
export function CampaignDialog({
  filtros,
  resumenFiltros,
  onClose,
}: {
  filtros: SegmentFilters;
  resumenFiltros: string;
  onClose: () => void;
}) {
  const [plantillas, setPlantillas] = useState<TemplateDto[] | null>(null);
  const [nombre, setNombre] = useState("");
  const [plantillaId, setPlantillaId] = useState("");
  const [valores, setValores] = useState<string[]>([]);
  const [campana, setCampana] = useState<CampaignDetailDto | null>(null);
  const [confirmo, setConfirmo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/templates").catch(() => null);
      if (!res?.ok) {
        setError("No se pudieron cargar las plantillas.");
        return;
      }
      const data = (await res.json()) as { templates: TemplateDto[] };
      setPlantillas(data.templates.filter((t) => t.status === "approved"));
    })();
  }, []);

  const plantilla = plantillas?.find((t) => t.id === plantillaId) ?? null;
  const nVars = plantilla ? countVariables(plantilla.body) : 0;

  const refrescar = useCallback(async (id: string) => {
    const res = await fetch(`/api/campaigns/${id}`).catch(() => null);
    if (!res?.ok) return;
    setCampana(((await res.json()) as { campaign: CampaignDetailDto }).campaign);
  }, []);

  // Mientras envía, se consulta el avance.
  useEffect(() => {
    if (!campana || campana.status !== "sending") return;
    const t = setInterval(() => void refrescar(campana.id), 2000);
    return () => clearInterval(t);
  }, [campana, refrescar]);

  async function crear() {
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: nombre.trim(),
        templateId: plantillaId,
        variables: Array.from({ length: nVars }, (_, i) => (valores[i] ?? "").trim()),
        filters: filtros,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setOcupado(false);
      setError(await mensajeDeError(res, "No se pudo crear la campaña."));
      return;
    }
    const { campaign } = (await res.json()) as { campaign: { id: string } };
    await refrescar(campaign.id);
    setOcupado(false);
  }

  async function accion(body: object) {
    if (!campana) return;
    setOcupado(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${campana.id}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      setError(await mensajeDeError(res, "No se pudo completar la acción."));
      return;
    }
    await refrescar(campana.id);
  }

  const faltaForm =
    !nombre.trim() ||
    !plantillaId ||
    Array.from({ length: nVars }).some((_, i) => !(valores[i] ?? "").trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Campaña por segmento"
    >
      <div
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-campana
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">Campaña por segmento</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!campana && (
          <div className="space-y-3">
            <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              Se enviará a las personas de WhatsApp que cumplan el filtro actual:{" "}
              <strong>{resumenFiltros}</strong>. Aún no se envía nada: primero
              revisas la lista.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="camp-nombre">
                Nombre de la campaña
              </label>
              <Input
                id="camp-nombre"
                value={nombre}
                maxLength={80}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Promoción de noviembre"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="camp-plantilla">
                Plantilla aprobada
              </label>
              <select
                id="camp-plantilla"
                value={plantillaId}
                onChange={(e) => {
                  setPlantillaId(e.target.value);
                  setValores([]);
                }}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">
                  {plantillas === null ? "Cargando…" : "Elige una plantilla"}
                </option>
                {(plantillas ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
              {plantillas && plantillas.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No hay plantillas aprobadas. Crea una en Ajustes → Plantillas
                  y espera la aprobación de Meta.
                </p>
              )}
            </div>
            {plantilla && (
              <p className="whitespace-pre-wrap rounded-md border p-2 text-xs">{plantilla.body}</p>
            )}
            {Array.from({ length: nVars }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor={`camp-var-${i}`}>
                  Valor de {`{{${i + 1}}}`}
                </label>
                <Input
                  id={`camp-var-${i}`}
                  value={valores[i] ?? ""}
                  onChange={(e) =>
                    setValores((v) => {
                      const next = [...v];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  placeholder="Texto fijo, o {nombre} para el primer nombre"
                />
              </div>
            ))}
            <Button disabled={faltaForm || ocupado} onClick={() => void crear()}>
              {ocupado ? "Armando la lista…" : "Revisar destinatarios"}
            </Button>
          </div>
        )}

        {campana && (
          <div className="space-y-3" data-campana-paso={campana.status}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{campana.name}</span>
              <Badge variant={campana.status === "done" ? "success" : "secondary"}>
                {ESTADO[campana.status]}
              </Badge>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                ["Total", campana.total],
                ["Enviados", campana.enviados],
                ["Fallidos", campana.fallidos],
                ["Omitidos", campana.omitidos],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border p-2">
                  <div className="text-base font-semibold">{v}</div>
                  {k}
                </div>
              ))}
            </div>

            {campana.ejemplo && (
              <div>
                <p className="mb-1 text-xs font-medium">Así le llegaría a la primera persona</p>
                <p className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">
                  {campana.ejemplo}
                </p>
              </div>
            )}

            {campana.problemas.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {campana.problemas.map((p, i) => (
                  <li key={i}>
                    {p.estado === "failed" ? "Falló" : "Omitido"}: {p.nombre}
                    {p.detalle ? ` — ${p.detalle}` : ""}
                  </li>
                ))}
              </ul>
            )}

            {!campana.whatsappListo && campana.status === "draft" && (
              <p role="alert" className="text-xs text-destructive">
                No hay un número de WhatsApp conectado: conéctalo en Ajustes antes de enviar.
              </p>
            )}

            {campana.status === "draft" && campana.pendientes > 0 && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmo}
                    onChange={(e) => setConfirmo(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <span>
                    Confirmo que enviaré este mensaje a{" "}
                    <strong>{campana.total} personas</strong>. No se puede deshacer lo ya enviado.
                  </span>
                </label>
                <div className="flex gap-2">
                  <Button
                    disabled={!confirmo || ocupado || !campana.whatsappListo}
                    onClick={() => void accion({ action: "send", confirmCount: campana.total })}
                  >
                    {campana.enviados + campana.fallidos + campana.omitidos > 0
                      ? "Reanudar envío"
                      : "Enviar ahora"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => void accion({ action: "cancel" })}
                  >
                    Descartar
                  </Button>
                </div>
              </>
            )}

            {campana.status === "sending" && (
              <Button variant="secondary" disabled={ocupado} onClick={() => void accion({ action: "cancel" })}>
                Detener envío
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
