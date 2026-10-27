import { digitsOnly, normalizeText } from "@/lib/search";

/**
 * 064 — Detección de contactos duplicados. Pura y sin imports de servidor: la
 * usan el servidor y las pruebas.
 *
 * Solo agrupa contactos del MISMO canal. Un cliente que escribe por WhatsApp e
 * Instagram tiene dos identidades que no se pueden reconciliar sin un mapa de
 * alias, y unirlos a medias haría que su siguiente mensaje de Instagram
 * recreara el contacto que se acaba de borrar.
 */

export type DupeCandidate = {
  id: string;
  name: string;
  phone: string | null;
  waUserId: string | null;
  waIdentity: string;
  channel: string;
  createdAt: string;
};

export type DupeReason = "telefono" | "bsuid" | "nombre";

export const DUPE_REASON_LABEL: Record<DupeReason, string> = {
  telefono: "Mismo teléfono",
  bsuid: "Mismo identificador de WhatsApp",
  nombre: "Mismo nombre",
};

export type DupeGroup = {
  ids: string[];
  razones: DupeReason[];
  /** `alta` si comparten teléfono o identificador; `media` si solo el nombre. */
  confianza: "alta" | "media";
};

const BSUID_PREFIX = "bsuid:";

/** Los últimos 10 dígitos: 521… y 52… del mismo número son el mismo número. */
export function claveTelefono(phone: string | null): string | null {
  const d = digitsOnly(phone ?? "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export function claveBsuid(c: Pick<DupeCandidate, "waUserId" | "waIdentity">): string | null {
  if (c.waUserId) return c.waUserId;
  return c.waIdentity.startsWith(BSUID_PREFIX)
    ? c.waIdentity.slice(BSUID_PREFIX.length) || null
    : null;
}

/**
 * Dos palabras o más y con letras: «Ana» o un teléfono guardado como nombre
 * (el respaldo del perfil) no cuentan, porque juntarían gente distinta.
 */
export function claveNombre(name: string, phone: string | null): string | null {
  const n = normalizeText(name).replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(n)) return null;
  if (n.split(" ").length < 2) return null;
  if (phone && digitsOnly(n) === digitsOnly(phone)) return null;
  return n;
}

export function detectarDuplicados(contactos: DupeCandidate[]): DupeGroup[] {
  const padre = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r)!;
    padre.set(x, r);
    return r;
  };
  for (const c of contactos) padre.set(c.id, c.id);

  const porRazon: Record<DupeReason, Map<string, string[]>> = {
    telefono: new Map(),
    bsuid: new Map(),
    nombre: new Map(),
  };
  const meter = (razon: DupeReason, clave: string | null, c: DupeCandidate) => {
    if (!clave) return;
    const k = `${c.channel}|${clave}`;
    const lista = porRazon[razon].get(k) ?? [];
    lista.push(c.id);
    porRazon[razon].set(k, lista);
  };
  for (const c of contactos) {
    meter("telefono", claveTelefono(c.phone), c);
    meter("bsuid", claveBsuid(c), c);
    meter("nombre", claveNombre(c.name, c.phone), c);
  }

  for (const mapa of Object.values(porRazon)) {
    for (const ids of mapa.values()) {
      for (let i = 1; i < ids.length; i++) {
        padre.set(raiz(ids[i]!), raiz(ids[0]!));
      }
    }
  }

  const grupos = new Map<string, { ids: Set<string>; razones: Set<DupeReason> }>();
  for (const c of contactos) {
    const r = raiz(c.id);
    const g = grupos.get(r) ?? { ids: new Set(), razones: new Set() };
    g.ids.add(c.id);
    grupos.set(r, g);
  }
  for (const [razon, mapa] of Object.entries(porRazon) as [
    DupeReason,
    Map<string, string[]>,
  ][]) {
    for (const ids of mapa.values()) {
      if (ids.length < 2) continue;
      grupos.get(raiz(ids[0]!))?.razones.add(razon);
    }
  }

  const orden: DupeReason[] = ["telefono", "bsuid", "nombre"];
  return [...grupos.values()]
    .filter((g) => g.ids.size >= 2)
    .map((g) => {
      const razones = orden.filter((r) => g.razones.has(r));
      return {
        ids: [...g.ids],
        razones,
        confianza: razones.some((r) => r !== "nombre") ? ("alta" as const) : ("media" as const),
      };
    })
    .sort((a, b) =>
      a.confianza === b.confianza ? b.ids.length - a.ids.length : a.confianza === "alta" ? -1 : 1
    );
}
