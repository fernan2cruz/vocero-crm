import { describe, expect, it } from "vitest";
import {
  procesarCampana,
  valoresPara,
  type CampanaDeps,
  type Destinatario,
  type EstadoDestinatario,
} from "@/lib/campaign";

function armar(
  destinatarios: Destinatario[],
  opts: {
    falla?: Record<string, { code?: string; message: string }>;
    cancelarTrasEnvios?: number;
  } = {}
) {
  const pendientes = [...destinatarios];
  const marcas = new Map<string, { estado: EstadoDestinatario; detalle: string | null }>();
  const enviados: { contactId: string; valores: string[] }[] = [];
  const deps: CampanaDeps = {
    tomar: async (n) => pendientes.filter((p) => !marcas.has(p.id)).slice(0, n),
    enviar: async (d, valores) => {
      const f = opts.falla?.[d.contactId];
      if (f) throw Object.assign(new Error(f.message), f.code ? { code: f.code } : {});
      enviados.push({ contactId: d.contactId, valores });
    },
    marcar: async (id, estado, detalle) => {
      marcas.set(id, { estado, detalle });
    },
    cancelada: async () =>
      opts.cancelarTrasEnvios !== undefined && enviados.length >= opts.cancelarTrasEnvios,
    pausa: async () => {},
  };
  return { deps, marcas, enviados };
}

const d = (n: number, nombre: string): Destinatario => ({
  id: `r${n}`,
  contactId: `c${n}`,
  nombre,
});

describe("064 — valoresPara", () => {
  it("rellena {nombre} con el primer nombre", () => {
    expect(valoresPara(["{nombre}", "fijo"], "Ana María Pérez")).toEqual({
      valores: ["Ana", "fijo"],
      faltan: false,
    });
  });

  it("sin nombre de pila, falta el valor", () => {
    expect(valoresPara(["{nombre}"], "+52 55 1234").faltan).toBe(true);
    expect(valoresPara(["{nombre}"], null).faltan).toBe(true);
  });

  it("un valor fijo no depende del nombre", () => {
    expect(valoresPara(["Promo"], null)).toEqual({ valores: ["Promo"], faltan: false });
  });
});

describe("064 — procesarCampana", () => {
  it("envía a todos y marca cada uno una vez", async () => {
    const { deps, marcas, enviados } = armar([d(1, "Ana Ruiz"), d(2, "Beto Paz")]);
    const r = await procesarCampana(deps, ["Hola {nombre}"], { throttleMs: 0 });
    expect(r).toMatchObject({ estado: "completa", enviados: 2, fallidos: 0, omitidos: 0 });
    expect(enviados.map((e) => e.valores[0])).toEqual(["Hola Ana", "Hola Beto"]);
    expect([...marcas.values()].every((m) => m.estado === "sent")).toBe(true);
  });

  it("un fallo normal no detiene al resto", async () => {
    const { deps, marcas } = armar([d(1, "Ana Ruiz"), d(2, "Beto Paz"), d(3, "Cata Díaz")], {
      falla: { c2: { code: "meta_error", message: "Meta rechazó" } },
    });
    const r = await procesarCampana(deps, ["x"], { throttleMs: 0 });
    expect(r).toMatchObject({ estado: "completa", enviados: 2, fallidos: 1 });
    expect(marcas.get("r2")).toEqual({ estado: "failed", detalle: "Meta rechazó" });
  });

  it("omite a quien no tiene nombre, sin intentar enviarle", async () => {
    const { deps, marcas, enviados } = armar([d(1, "5215512345678"), d(2, "Beto Paz")]);
    const r = await procesarCampana(deps, ["{nombre}"], { throttleMs: 0 });
    expect(r).toMatchObject({ enviados: 1, omitidos: 1 });
    expect(enviados.map((e) => e.contactId)).toEqual(["c2"]);
    expect(marcas.get("r1")?.estado).toBe("skipped");
  });

  it("un error fatal interrumpe SIN marcar al afectado: se puede reanudar", async () => {
    const { deps, marcas, enviados } = armar([d(1, "Ana Ruiz"), d(2, "Beto Paz"), d(3, "Cata Díaz")], {
      falla: { c2: { code: "reconnect_required", message: "Reconecta el número" } },
    });
    const r = await procesarCampana(deps, ["x"], { throttleMs: 0 });
    expect(r.estado).toBe("interrumpida");
    expect(r.motivo).toBe("Reconecta el número");
    expect(enviados.map((e) => e.contactId)).toEqual(["c1"]);
    expect(marcas.has("r2")).toBe(false);
    expect(marcas.has("r3")).toBe(false);
  });

  it("reanudar no repite lo ya enviado", async () => {
    const todos = [d(1, "Ana Ruiz"), d(2, "Beto Paz"), d(3, "Cata Díaz")];
    const a = armar(todos, { falla: { c2: { code: "not_connected", message: "Sin número" } } });
    await procesarCampana(a.deps, ["x"], { throttleMs: 0 });
    expect(a.enviados).toHaveLength(1);
    // Se arregla el problema: los marcados siguen marcados, solo faltan 2.
    const sigue = armar(todos);
    for (const [id, m] of a.marcas) sigue.marcas.set(id, m);
    await procesarCampana(sigue.deps, ["x"], { throttleMs: 0 });
    expect(sigue.enviados.map((e) => e.contactId)).toEqual(["c2", "c3"]);
  });

  it("cancelar corta antes del siguiente envío", async () => {
    const { deps, enviados } = armar([d(1, "Ana Ruiz"), d(2, "Beto Paz"), d(3, "Cata Díaz")], {
      cancelarTrasEnvios: 1,
    });
    const r = await procesarCampana(deps, ["x"], { throttleMs: 0 });
    expect(r.estado).toBe("cancelada");
    expect(enviados).toHaveLength(1);
  });

  it("sin pendientes termina enseguida", async () => {
    const { deps } = armar([]);
    expect(await procesarCampana(deps, ["x"], { throttleMs: 0 })).toMatchObject({
      estado: "completa",
      enviados: 0,
    });
  });
});
