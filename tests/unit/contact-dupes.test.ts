import { describe, expect, it } from "vitest";
import {
  claveBsuid,
  claveNombre,
  claveTelefono,
  detectarDuplicados,
  type DupeCandidate,
} from "@/lib/contact-dupes";

let n = 0;
const c = (over: Partial<DupeCandidate>): DupeCandidate => ({
  id: `ct_${++n}`,
  name: "Persona",
  phone: null,
  waUserId: null,
  waIdentity: `x${n}`,
  channel: "whatsapp",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("064 — claves", () => {
  it("teléfono: 521… y 52… del mismo número coinciden; uno corto no cuenta", () => {
    expect(claveTelefono("5215512345678")).toBe(claveTelefono("525512345678"));
    expect(claveTelefono("123")).toBeNull();
    expect(claveTelefono(null)).toBeNull();
  });

  it("bsuid: de la columna o de la identidad", () => {
    expect(claveBsuid({ waUserId: "U1", waIdentity: "5215512345678" })).toBe("U1");
    expect(claveBsuid({ waUserId: null, waIdentity: "bsuid:U2" })).toBe("U2");
    expect(claveBsuid({ waUserId: null, waIdentity: "5215512345678" })).toBeNull();
  });

  it("nombre: dos palabras con letras; sin acentos ni mayúsculas", () => {
    expect(claveNombre("María  Pérez", null)).toBe(claveNombre("maria perez", null));
    expect(claveNombre("Ana", null)).toBeNull();
    expect(claveNombre("5215512345678", "5215512345678")).toBeNull();
    expect(claveNombre("+52 55 1234 5678", null)).toBeNull();
  });
});

describe("064 — detectarDuplicados", () => {
  it("agrupa por teléfono con confianza alta", () => {
    const a = c({ phone: "5215512345678", name: "A" });
    const b = c({ phone: "525512345678", name: "B" });
    const solo = c({ phone: "5215599999999", name: "C" });
    const g = detectarDuplicados([a, b, solo]);
    expect(g).toHaveLength(1);
    expect(g[0]?.ids.sort()).toEqual([a.id, b.id].sort());
    expect(g[0]?.razones).toEqual(["telefono"]);
    expect(g[0]?.confianza).toBe("alta");
  });

  it("el mismo BSUID en dos contactos es duplicado", () => {
    const a = c({ waUserId: "U1" });
    const b = c({ waIdentity: "bsuid:U1" });
    const g = detectarDuplicados([a, b]);
    expect(g[0]?.razones).toContain("bsuid");
    expect(g[0]?.confianza).toBe("alta");
  });

  it("solo el nombre → confianza media", () => {
    const g = detectarDuplicados([c({ name: "Luis Gómez" }), c({ name: "luis gomez" })]);
    expect(g[0]?.razones).toEqual(["nombre"]);
    expect(g[0]?.confianza).toBe("media");
  });

  it("nunca junta canales distintos, aunque el teléfono coincida", () => {
    const g = detectarDuplicados([
      c({ phone: "5215512345678", channel: "whatsapp" }),
      c({ phone: "5215512345678", channel: "instagram" }),
    ]);
    expect(g).toEqual([]);
  });

  it("une en cadena: A~B por teléfono y B~C por nombre → un grupo de 3", () => {
    const a = c({ phone: "5215512345678", name: "Rosa Díaz" });
    const b = c({ phone: "5215512345678", name: "Rosa Diaz Lopez" });
    const cc = c({ name: "rosa diaz lopez" });
    const g = detectarDuplicados([a, b, cc]);
    expect(g).toHaveLength(1);
    expect(g[0]?.ids).toHaveLength(3);
  });

  it("sin duplicados, vacío; y las altas van antes que las medias", () => {
    expect(detectarDuplicados([c({}), c({})])).toEqual([]);
    const media = [c({ name: "Pedro Ruiz" }), c({ name: "pedro ruiz" })];
    const alta = [c({ phone: "5215500000001" }), c({ phone: "5215500000001" })];
    const g = detectarDuplicados([...media, ...alta]);
    expect(g.map((x) => x.confianza)).toEqual(["alta", "media"]);
  });
});
