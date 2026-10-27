"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import {
  TAG_COLORS,
  TAG_COLOR_LABEL,
  TAG_DOT_CLASS,
  type ContactTagDto,
  type TagColor,
  type TagWithCount,
} from "@/lib/contact-tags";
import { Input } from "@/components/ui/input";

/** La etiqueta como chip: punto de color + nombre. */
export function TagChip({
  tag,
  onRemove,
}: {
  tag: ContactTagDto;
  onRemove?: () => void;
}) {
  return (
    <span
      data-tag={tag.name}
      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium"
    >
      <span className={`h-2 w-2 rounded-full ${TAG_DOT_CLASS[tag.color]}`} />
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar la etiqueta ${tag.name}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

/**
 * Pegar y quitar etiquetas de un contacto. Cada cambio se guarda al momento
 * (`PUT /api/contacts/:id/tags`): no hay un «Guardar» aparte que olvidar, y la
 * etiqueta nueva queda creada en el catálogo del negocio.
 */
export function TagPicker({
  contactId,
  value,
  catalog,
  onCatalogChange,
  onChange,
}: {
  contactId: string;
  value: ContactTagDto[];
  catalog: TagWithCount[];
  onCatalogChange: () => void;
  onChange: (tags: ContactTagDto[]) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState<TagColor>("azul");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar(ids: string[]) {
    const res = await fetch(`/api/contacts/${contactId}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagIds: ids }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudieron guardar las etiquetas. Intenta de nuevo.");
      return;
    }
    setError(null);
    const data = (await res.json()) as { tags: ContactTagDto[] };
    onChange(data.tags);
    onCatalogChange();
  }

  async function crear() {
    const limpio = nombre.trim();
    if (!limpio) return;
    setOcupado(true);
    setError(null);
    const existente = catalog.find(
      (t) => t.name.toLowerCase() === limpio.toLowerCase()
    );
    let tag: ContactTagDto | undefined = existente;
    if (!existente) {
      const res = await fetch("/api/contact-tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: limpio, color }),
      }).catch(() => null);
      if (!res?.ok) {
        setOcupado(false);
        setError("No se pudo crear la etiqueta.");
        return;
      }
      tag = ((await res.json()) as { tag: ContactTagDto }).tag;
    }
    if (tag && !value.some((t) => t.id === tag!.id)) {
      await guardar([...value.map((t) => t.id), tag.id]);
    }
    setNombre("");
    setOcupado(false);
  }

  const disponibles = catalog.filter((t) => !value.some((v) => v.id === t.id));

  return (
    <div className="space-y-2" data-tag-picker>
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">Sin etiquetas</span>
        )}
        {value.map((t) => (
          <TagChip
            key={t.id}
            tag={t}
            onRemove={() =>
              void guardar(value.filter((v) => v.id !== t.id).map((v) => v.id))
            }
          />
        ))}
      </div>

      {disponibles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {disponibles.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void guardar([...value.map((v) => v.id), t.id])}
              aria-label={`Agregar la etiqueta ${t.name}`}
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void crear();
            }
          }}
          maxLength={40}
          placeholder="Nueva etiqueta…"
          aria-label="Nombre de la etiqueta nueva"
          className="h-8 text-sm"
        />
        <select
          value={color}
          onChange={(e) => setColor(e.target.value as TagColor)}
          aria-label="Color de la etiqueta nueva"
          className="h-8 rounded-md border border-input bg-card px-1.5 text-xs"
        >
          {TAG_COLORS.map((c) => (
            <option key={c} value={c}>
              {TAG_COLOR_LABEL[c]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void crear()}
          disabled={!nombre.trim() || ocupado}
          className="h-8 rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Agregar
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
