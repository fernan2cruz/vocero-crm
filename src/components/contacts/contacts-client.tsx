"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  BotOff,
  Copy,
  Download,
  History,
  Megaphone,
  MessageSquareText,
  Search,
  Send,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import {
  limpiarFiltros,
  type ContactSegmentDto,
  type ContactTagDto,
  type SegmentFilters,
  type TagWithCount,
} from "@/lib/contact-tags";
import { formatPhone } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SOURCE_LABELS } from "@/server/contact-source";
import { priorityRank } from "@/server/leads/priority";
import { PriorityBadge } from "@/components/pipeline/priority-picker";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { NewContactDialog } from "./new-contact-dialog";
import { StartConversation } from "./start-conversation";
import { TagChip, TagPicker } from "./tag-picker";
import { VentasPanel } from "./ventas-panel";
import { TimelineDialog } from "./timeline-dialog";
import { DuplicatesDialog } from "./duplicates-dialog";
import { CampaignDialog } from "./campaign-dialog";
import { formatMoneyCents } from "@/lib/money";

export function ContactsClient() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [stages, setStages] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  // 064 — etiquetas y segmentos
  const [tag, setTag] = useState("all");
  const [source, setSource] = useState("all");
  const [sinAgente, setSinAgente] = useState(false);
  const [tipo, setTipo] = useState("all");
  const [catalogo, setCatalogo] = useState<TagWithCount[]>([]);
  const [segmentos, setSegmentos] = useState<ContactSegmentDto[]>([]);
  const [segmentoId, setSegmentoId] = useState("");
  const [nombrandoSegmento, setNombrandoSegmento] = useState(false);
  const [nombreSegmento, setNombreSegmento] = useState("");
  const [errorSegmento, setErrorSegmento] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [escribiendo, setEscribiendo] = useState<ContactDto | null>(null);
  const [historial, setHistorial] = useState<ContactDto | null>(null);
  const [buscandoDuplicados, setBuscandoDuplicados] = useState(false);
  const [campana, setCampana] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mismo rescate que en la Bandeja: lo tecleado antes de que hidrate el JS
  // se perdía en silencio. Ver conversation-list.tsx.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pipeline/stages").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { stages: { name: string }[] };
      setStages(data.stages.map((s) => s.name));
    })();
  }, []);

  const cargarCatalogo = useCallback(async () => {
    const [t, s] = await Promise.all([
      fetch("/api/contact-tags").catch(() => null),
      fetch("/api/contact-segments").catch(() => null),
    ]);
    if (t?.ok) setCatalogo(((await t.json()) as { tags: TagWithCount[] }).tags);
    if (s?.ok)
      setSegmentos(((await s.json()) as { segments: ContactSegmentDto[] }).segments);
  }, []);

  useEffect(() => {
    void cargarCatalogo();
  }, [cargarCatalogo]);

  /** Lo que el filtro de hoy diría como segmento guardable. */
  const filtrosActuales: SegmentFilters = limpiarFiltros({
    q: query,
    stage,
    tag,
    source,
    ai: sinAgente ? "paused" : "",
    tipo,
  });

  /** El filtro puesto, dicho con palabras, para que la campaña lo muestre. */
  function resumenDeFiltros(): string {
    const f = filtrosActuales;
    const partes: string[] = [];
    if (f.q) partes.push(`búsqueda «${f.q}»`);
    if (f.stage) partes.push(`etapa ${f.stage}`);
    if (f.tag) partes.push(`etiqueta ${catalogo.find((t) => t.id === f.tag)?.name ?? ""}`.trim());
    if (f.source) partes.push(`fuente ${f.source}`);
    if (f.tipo) partes.push(f.tipo === "cliente" ? "solo clientes" : "solo prospectos");
    if (f.ai) partes.push("sin agente");
    return partes.length > 0 ? partes.join(", ") : "toda la lista de contactos";
  }

  function aplicarSegmento(id: string) {
    setSegmentoId(id);
    const f = segmentos.find((s) => s.id === id)?.filters ?? {};
    setQuery(f.q ?? "");
    if (inputRef.current) inputRef.current.value = f.q ?? "";
    setStage(f.stage ?? "all");
    setTag(f.tag ?? "all");
    setSource(f.source ?? "all");
    setSinAgente(f.ai === "paused");
    setTipo(f.tipo ?? "all");
  }

  async function guardarSegmento() {
    const nombre = nombreSegmento.trim();
    if (!nombre) return;
    setErrorSegmento(null);
    const res = await fetch("/api/contact-segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nombre, filters: filtrosActuales }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setErrorSegmento(data?.error?.message ?? "No se pudo guardar el segmento");
      return;
    }
    const { segment } = (await res.json()) as { segment: ContactSegmentDto };
    await cargarCatalogo();
    setSegmentoId(segment.id);
    setNombrandoSegmento(false);
    setNombreSegmento("");
  }

  async function borrarSegmento() {
    if (!segmentoId) return;
    await fetch(`/api/contact-segments/${segmentoId}`, { method: "DELETE" }).catch(
      () => null
    );
    setSegmentoId("");
    await cargarCatalogo();
  }

  /** Los filtros de la pantalla como query: los comparten la lista y la exportación. */
  const paramsDeFiltros = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (stage !== "all") params.set("stage", stage);
    if (tag !== "all") params.set("tag", tag);
    if (source !== "all") params.set("source", source);
    if (sinAgente) params.set("ai", "paused");
    if (tipo !== "all") params.set("tipo", tipo);
    if (showArchived) params.set("archived", "true");
    return params;
  }, [query, stage, tag, source, sinAgente, tipo, showArchived]);

  const refetch = useCallback(async () => {
    const params = paramsDeFiltros();
    const res = await fetch(`/api/contacts?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { contacts: ContactDto[] };
    // A quién llamar primero: alta arriba, sin prioridad al final. El orden lo
    // decide esta lista, no el servidor, porque es una preferencia de trabajo y
    // no un dato del contacto.
    setContacts(
      [...data.contacts].sort(
        (a, b) => priorityRank(a.priority ?? null) - priorityRank(b.priority ?? null)
      )
    );
  }, [paramsDeFiltros]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Contactos</h2>
          <Button size="sm" onClick={() => setCreando(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo contacto
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setImportando(true)}>
            <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Importar
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCampana(true)}>
            <Megaphone className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Campaña
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setBuscandoDuplicados(true)}>
            <Copy className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Duplicados
          </Button>
          {/* 064 — baja la lista tal como está filtrada */}
          <a
            href={`/api/contacts/export?${paramsDeFiltros()}`}
            download
            data-exportar
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <Download className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Exportar CSV
          </a>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Ver archivados
          </label>
          {stages.length > 0 && (
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Filtrar por etapa del embudo"
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="all">Toda etapa</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {catalogo.length > 0 && (
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              aria-label="Filtrar por etiqueta"
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="all">Toda etiqueta</option>
              {catalogo.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.contacts})
                </option>
              ))}
            </select>
          )}
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filtrar por fuente"
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="all">Toda fuente</option>
            {(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map(
              (s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              )
            )}
          </select>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Filtrar por clientes o prospectos"
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="all">Clientes y prospectos</option>
            <option value="cliente">Solo clientes</option>
            <option value="prospecto">Solo prospectos</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={sinAgente}
              onChange={(e) => setSinAgente(e.target.checked)}
              className="accent-primary"
            />
            Sin agente
          </label>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar por nombre o teléfono…"
              aria-label="Buscar contacto"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </div>
      </header>

      {/* 064 — Segmentos: un filtro guardado con nombre */}
      <div
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm sm:px-6"
        data-segmentos
      >
        <span className="text-xs text-muted-foreground">Segmento</span>
        <select
          value={segmentoId}
          onChange={(e) => aplicarSegmento(e.target.value)}
          aria-label="Aplicar un segmento guardado"
          className="h-8 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">Ninguno</option>
          {segmentos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {segmentoId && (
          <Button size="sm" variant="ghost" onClick={() => void borrarSegmento()}>
            Borrar segmento
          </Button>
        )}
        {nombrandoSegmento ? (
          <>
            <Input
              value={nombreSegmento}
              onChange={(e) => setNombreSegmento(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void guardarSegmento();
              }}
              placeholder="Nombre del segmento"
              aria-label="Nombre del segmento"
              maxLength={60}
              className="h-8 w-48"
            />
            <Button
              size="sm"
              disabled={!nombreSegmento.trim()}
              onClick={() => void guardarSegmento()}
            >
              Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNombrandoSegmento(false)}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={Object.keys(filtrosActuales).length === 0}
            onClick={() => setNombrandoSegmento(true)}
          >
            Guardar filtro como segmento
          </Button>
        )}
        {errorSegmento && (
          <span role="alert" className="text-xs text-destructive">
            {errorSegmento}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {contacts.length === 0 ? (
          Object.keys(filtrosActuales).length > 0 ? (
            <EmptyState
              icon={Search}
              className="h-full"
              title="Sin resultados"
              description={
                <>
                  Nadie coincide con
                  {query.trim() ? ` «${query.trim()}»` : " los filtros aplicados"}
                  {query.trim() && stage !== "all" ? " en" : ""}
                  {stage !== "all" ? ` la etapa «${stage}»` : ""}.
                </>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              className="h-full"
              title="Sin contactos"
              description="Cada persona que escriba a tu WhatsApp quedará registrada aquí automáticamente."
            />
          )
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-3 sm:flex-nowrap sm:gap-x-4 sm:px-4"
              >
                <ContactAvatar name={c.name} seed={c.id} />
                {/* El 60% mínimo es lo que empuja los botones a su propio
                    renglón en el teléfono en vez de exprimir el nombre. */}
                <div className="min-w-[60%] flex-1 sm:min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name}
                    </span>
                    {c.esCliente && (
                      <Badge variant="success" data-cliente>
                        Cliente
                        {c.valor
                          ? ` · ${formatMoneyCents(c.valor.totalCents, c.valor.currency)}${
                              c.valor.ventas > 1 ? ` · ${c.valor.ventas} compras` : ""
                            }`
                          : ""}
                      </Badge>
                    )}
                    {c.priority && <PriorityBadge value={c.priority} />}
                    {c.stageName && (
                      <Badge variant="outline">{c.stageName}</Badge>
                    )}
                    {c.archivedAt && (
                      <Badge variant="secondary">Archivado</Badge>
                    )}
                    {c.aiPaused && (
                      <Badge
                        variant="warning"
                        title="El agente no le responde a este contacto: lo atiendes tú"
                      >
                        <BotOff className="mr-1 h-3 w-3" strokeWidth={1.8} />
                        Sin agente
                      </Badge>
                    )}
                    {/* Solo la fuente que alguien capturó: presentar una
                        deducción como dato la volvería un número inventado en
                        cuanto se cuente por fuente. */}
                    {c.source?.source === "capturada" && (
                      <Badge variant="secondary">
                        {SOURCE_LABELS[c.source.value]}
                      </Badge>
                    )}
                    {(c.tags ?? []).map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(c.phone)}
                    {c.notes ? ` · ${c.notes.slice(0, 60)}` : ""}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(c)}
                  >
                    Editar
                  </Button>
                  {/* A quien nunca escribió hay que abrirle la conversación con
                      una plantilla: es regla de Meta, no del CRM. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Escribir primero"
                    title="Escribir primero (con plantilla)"
                    onClick={() => setEscribiendo(c)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Link href={`/inbox?contact=${c.id}`}>
                    <Button variant="ghost" size="icon" aria-label="Abrir conversación">
                      <MessageSquareText className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ver historial"
                    title="Historial del cliente"
                    onClick={() => setHistorial(c)}
                  >
                    <History className="h-4 w-4" strokeWidth={1.8} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                    onClick={() => void patch(c.id, { archived: !c.archivedAt })}
                  >
                    {c.archivedAt ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {campana && (
        <CampaignDialog
          filtros={filtrosActuales}
          resumenFiltros={resumenDeFiltros()}
          onClose={() => setCampana(false)}
        />
      )}

      {buscandoDuplicados && (
        <DuplicatesDialog
          onClose={() => setBuscandoDuplicados(false)}
          onMerged={() => {
            void refetch();
            void cargarCatalogo();
          }}
        />
      )}

      {historial && (
        <TimelineDialog
          contactId={historial.id}
          nombre={historial.name}
          onClose={() => setHistorial(null)}
        />
      )}

      {editing && (
        <EditDialog
          contact={editing}
          catalogo={catalogo}
          onCatalogoChange={() => {
            void cargarCatalogo();
            void refetch();
          }}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            await patch(editing.id, patchBody);
            setEditing(null);
          }}
        />
      )}

      {escribiendo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Escribir primero"
        >
          <div className="w-full max-w-md rounded-lg border bg-popover p-4 shadow-pop">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                Escribir a {escribiendo.name}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEscribiendo(null)}>
                Cerrar
              </Button>
            </div>
            <StartConversation
              contactId={escribiendo.id}
              onStarted={() => {
                const contactId = escribiendo.id;
                setEscribiendo(null);
                // La Bandeja resuelve por CONTACTO (`?contact=`), no por
                // conversación: con `?conversation=` no seleccionaría nada.
                router.push(`/inbox?contact=${contactId}`);
              }}
            />
          </div>
        </div>
      )}

      {importando && (
        <ImportContactsDialog
          onClose={() => setImportando(false)}
          onImported={() => void refetch()}
        />
      )}

      {creando && (
        <NewContactDialog
          onClose={() => setCreando(false)}
          onCreated={() => {
            setCreando(false);
            void refetch();
          }}
          onOpenExisting={(contactId) => {
            setCreando(false);
            router.push(`/inbox?contact=${contactId}`);
          }}
        />
      )}
    </div>
  );
}

function EditDialog({
  contact,
  catalogo,
  onCatalogoChange,
  onClose,
  onSave,
}: {
  contact: ContactDto;
  catalogo: TagWithCount[];
  onCatalogoChange: () => void;
  onClose: () => void;
  onSave: (patch: { name: string; notes: string; aiPaused?: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(contact.name);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [aiPaused, setAiPaused] = useState(contact.aiPaused ?? false);
  const [etiquetas, setEtiquetas] = useState<ContactTagDto[]>(contact.tags ?? []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Editar contacto</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-name">
              Nombre
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-notes">
              Notas
            </label>
            <Textarea
              id="edit-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {/* 064 */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Etiquetas</span>
            <TagPicker
              contactId={contact.id}
              value={etiquetas}
              catalog={catalogo}
              onChange={setEtiquetas}
              onCatalogChange={onCatalogoChange}
            />
          </div>
          {/* 064 */}
          <VentasPanel contactId={contact.id} onChange={onCatalogoChange} />
          {/* 027 */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={aiPaused}
              onChange={(e) => setAiPaused(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              El agente no le responde
              <span className="block text-[11px] text-text-3">
                Sus mensajes llegan a la Bandeja y los atiendes tú.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              void onSave({
                name: name.trim(),
                notes,
                // Solo si cambió: mandarlo siempre reescribiría el interruptor
                // de la Bandeja cada vez que alguien corrige un nombre.
                ...(aiPaused !== (contact.aiPaused ?? false) ? { aiPaused } : {}),
              })
            }
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
