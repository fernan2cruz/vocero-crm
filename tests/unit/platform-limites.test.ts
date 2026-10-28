import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const m = vi.hoisted(() => ({ db: vi.fn(), modo: vi.fn(), proveedor: vi.fn(), saldo: vi.fn(), credencial: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
vi.mock("@/server/platform/ai-usage", () => ({ modoIaDe: m.modo, proveedorPlataforma: m.proveedor, extraerUso: vi.fn(), registrarUso: vi.fn() }));
vi.mock("@/server/platform/credit", () => ({ saldoDe: m.saldo }));
vi.mock("@/server/ai/credentials", () => ({ getAiCredentialSecret: m.credencial, getAiCredentialPublic: m.credencial, marcarEstadoPorRespuesta: vi.fn() }));

import { schema } from "@/lib/db";
import { comprobarLimiteDiario, comprobarDestinatarios, alcanzoTopeMensual, limitesDe, fijarLimites,
  verificarLimiteDiario, verificarDestinatarios, topeMensualAlcanzado, usoActualDe, type Limites } from "@/server/platform/limites";
import { limitesSchema } from "@/server/platform/schemas";
import { estadoIaDe, resolveAiProvider, mensajeDeEstado } from "@/lib/ai/provider";
import { pensarPorElCerebro } from "@/server/bot/llm-proxy";
import { accionesPlataforma, resumenDetalle } from "@/lib/platform-ui";

const sinLimites: Limites = { maxMessagesPerDay: null, maxCampaignRecipients: null, maxMonthlySpendMicros: null };
let limites: Limites | undefined;
let mensajes: number, gasto: number, zona: string, falloLectura: boolean, falloAuditoria: boolean;
let auditoria: Record<string, unknown>[];
const consultas: { tabla: unknown; sql: string; params: unknown[] }[] = [];
const db = {
  select: () => ({ from: (tabla: unknown) => {
    const resultado = () => tabla === schema.organizationLimits ? (limites ? [{ ...limites }] : [])
      : tabla === schema.calendarSettings ? [{ timezone: zona }]
      : tabla === schema.message ? [{ n: mensajes }]
      : tabla === schema.aiUsage ? [{ n: gasto }] : [{ id: "org_1" }];
    const consulta = {
      innerJoin: (_tabla: unknown, filtro: SQL) => { registrar(filtro); return consulta; },
      where: (filtro: SQL) => { if (falloLectura) throw new Error("datos sensibles del fallo"); registrar(filtro); return consulta; },
      limit: async () => resultado(), for: async () => resultado(),
      then: (resolver: (r: unknown[]) => unknown) => Promise.resolve(resultado()).then(resolver),
    };
    function registrar(filtro: SQL) { consultas.push({ tabla, ...new PgDialect().sqlToQuery(filtro) }); }
    return consulta;
  } }),
  insert: (tabla: unknown) => ({ values: (valor: Record<string, unknown>) => {
    if (tabla === schema.organizationLimits) return { onConflictDoUpdate: async () => { limites = { ...valor } as Limites; } };
    if (falloAuditoria) throw new Error("falló auditoría");
    auditoria.push(valor); return Promise.resolve();
  } }),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const antes = limites;
    try { return await fn(db); } catch (e) { limites = antes; throw e; }
  },
};
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); vi.stubEnv("OPENROUTER_API_TOKEN", "");
  limites = undefined; mensajes = 0; gasto = 0; zona = "America/Caracas";
  falloLectura = false; falloAuditoria = false; auditoria = []; consultas.length = 0;
  m.db.mockReset().mockReturnValue(db); m.modo.mockReset().mockResolvedValue("platform");
  m.saldo.mockReset().mockResolvedValue(100); m.credencial.mockReset().mockResolvedValue(null);
  m.proveedor.mockReset().mockResolvedValue({ source: "platform", token: "llave-super-secreta-1234", model: "m", judgeModel: "m", baseUrl: "https://ia.test" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("065 S7 — límites con base simulada", () => {
  it("sin fila o con null no limita y evita contar mensajes", async () => {
    expect(await limitesDe("org_1")).toEqual(sinLimites);
    await verificarLimiteDiario("org_1");
    limites = { ...sinLimites }; await verificarLimiteDiario("org_1");
    expect(consultas.some((q) => q.tabla === schema.message)).toBe(false);
  });
  it.each([4, 5, 6])("diario: %s usados frente a un tope de 5", async (n) => {
    limites = { ...sinLimites, maxMessagesPerDay: 5 }; mensajes = n;
    if (n < 5) await expect(verificarLimiteDiario("org_1")).resolves.toBeUndefined();
    else await expect(verificarLimiteDiario("org_1")).rejects.toMatchObject({ code: "limite_diario", message: "Se alcanzó el límite de 5 mensajes por día de este negocio" });
  });
  it("excluye is_test, fallidos y otras organizaciones; hoy empieza a medianoche local", async () => {
    limites = { ...sinLimites, maxMessagesPerDay: 5 };
    await verificarLimiteDiario("org_1", false, new Date("2026-10-27T02:00:00Z"));
    const filtros = consultas.filter((q) => q.tabla === schema.message);
    const sql = filtros.map((q) => q.sql).join(" ");
    const params = filtros.flatMap((q) => q.params);
    expect(sql).toContain('"conversation"."is_test" =');
    expect(sql).toContain('"message"."status" <>');
    expect(sql).toContain('"message"."direction" =');
    expect(sql).toContain('"message"."organization_id" =');
    expect(sql).toContain('"conversation"."organization_id" =');
    expect(params).toEqual(expect.arrayContaining([false, "out", "failed", "org_1", "2026-10-26T04:00:00.000Z", "2026-10-27T04:00:00.000Z"]));
    m.db.mockClear(); await verificarLimiteDiario("org_1", true);
    expect(m.db).not.toHaveBeenCalled();
  });
  it("un fallo de lectura deja pasar sin registrar datos del error", async () => {
    falloLectura = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(verificarLimiteDiario("org_1")).resolves.toBeUndefined();
    await expect(verificarDestinatarios("org_1", 100)).resolves.toBeUndefined();
    expect(await topeMensualAlcanzado("org_1")).toBe(false);
    expect(log.mock.calls).toEqual([
      ["[platform] No se pudo leer el límite diario"], ["[platform] No se pudo leer el límite de destinatarios"], ["[platform] No se pudo leer el tope mensual de IA"],
    ]);
  });
  it("también deja pasar si falla el conteo después de leer el límite", async () => {
    limites = { ...sinLimites, maxMessagesPerDay: 5 };
    let n = 0; m.db.mockImplementation(() => { if (++n > 1) throw new Error("BD caída"); return db; });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(verificarLimiteDiario("org_1")).resolves.toBeUndefined();
  });
  it("destinatarios admite el tope exacto y rechaza solo al superarlo", async () => {
    limites = { ...sinLimites, maxCampaignRecipients: 5 };
    await expect(verificarDestinatarios("org_1", 5)).resolves.toBeUndefined();
    await expect(verificarDestinatarios("org_1", 6)).rejects.toMatchObject({ code: "limite_destinatarios", message: "Esta campaña tiene 6 destinatarios y el límite del negocio es 5" });
    expect(() => comprobarDestinatarios(null, 10000)).not.toThrow();
    expect(() => comprobarLimiteDiario(null, 10000)).not.toThrow();
  });
  it("uso actual cuenta el mes calendario UTC, con organización explícita", async () => {
    mensajes = 120; gasto = 200;
    expect(await usoActualDe("org_1", new Date("2026-10-27T00:00:00Z"))).toEqual({ mensajesHoy: 120, gastoMesMicros: 200 });
    const q = consultas.find((q) => q.tabla === schema.aiUsage)!;
    // Solo el agente real (`bot`) cuenta para el tope: el Laboratorio y el juez no.
    expect(q.params).toEqual(["org_1", "bot", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  });
  it("guardado y auditoría son atómicos, con antes y después", async () => {
    const despues = { ...sinLimites, maxMessagesPerDay: 5 };
    expect(await fijarLimites("org_1", despues, "admin")).toBe(true);
    expect(auditoria[0]).toMatchObject({ action: "limits.set", actorUserId: "admin", organizationId: "org_1", detail: { antes: sinLimites, despues } });
    falloAuditoria = true;
    await expect(fijarLimites("org_1", sinLimites, "admin")).rejects.toThrow();
    expect(limites).toMatchObject(despues);
    expect(accionesPlataforma["limits.set"]).toBe("Cambiar límites del negocio");
    const resumen = resumenDetalle("limits.set", { antes: sinLimites, despues: { ...despues, token: "secreto" } });
    expect(resumen).toContain("mensajes por día: 5"); expect(resumen).not.toContain("secreto");
  });
  it("Zod exige los tres campos positivos enteros o null y rechaza claves extra", () => {
    expect(limitesSchema.safeParse(sinLimites).success).toBe(true);
    expect(limitesSchema.safeParse({ maxMessagesPerDay: 1, maxCampaignRecipients: 1, maxMonthlySpendMicros: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    for (const campo of Object.keys(sinLimites)) for (const valor of [0, -1, 0.1, "1", undefined, Number.MAX_SAFE_INTEGER + 1]) {
      expect(limitesSchema.safeParse({ ...sinLimites, [campo]: valor }).success).toBe(false);
    }
    expect(limitesSchema.safeParse({ ...sinLimites, otra: 1 }).success).toBe(false);
  });
  it("apagada: cero consultas para todas las operaciones de límites", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    await limitesDe("org_1"); await usoActualDe("org_1"); await verificarLimiteDiario("org_1");
    await verificarDestinatarios("org_1", 100); await topeMensualAlcanzado("org_1"); await fijarLimites("org_1", sinLimites, "admin");
    expect(m.db).not.toHaveBeenCalled();
  });
});

describe("tope mensual en IA de plataforma", () => {
  it.each([99, 100, 101])("con gasto %s decide sin revelar ni leer la llave al bloquear", async (n) => {
    limites = { ...sinLimites, maxMonthlySpendMicros: 100 }; gasto = n;
    expect(alcanzoTopeMensual(100, n)).toBe(n >= 100);
    const estado = await estadoIaDe("org_1");
    if (n < 100) expect(estado.activa).toBe(true);
    else {
      expect(estado).toEqual({ activa: false, motivo: "tope_mensual", last4: "", desde: null, plataforma: true });
      expect(mensajeDeEstado(estado)).toBe("Se alcanzó el tope mensual de IA de este negocio");
      expect(m.proveedor).not.toHaveBeenCalled(); expect(m.saldo).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(estado)).not.toContain("1234");
  });
  it("con llave propia no lee límites ni consumo; apagada tampoco resuelve modo", async () => {
    m.modo.mockResolvedValue("own_key");
    await estadoIaDe("org_1"); await resolveAiProvider("org_1");
    expect(m.db).not.toHaveBeenCalled(); expect(m.proveedor).not.toHaveBeenCalled();
    m.modo.mockClear(); vi.stubEnv("PLATAFORMA", "off");
    await estadoIaDe("org_1"); await resolveAiProvider("org_1");
    expect(m.db).not.toHaveBeenCalled(); expect(m.modo).not.toHaveBeenCalled();
  });
  it("el proxy responde 402 tope_mensual sin llamar al proveedor ni filtrar la llave", async () => {
    limites = { ...sinLimites, maxMonthlySpendMicros: 100 }; gasto = 100;
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await pensarPorElCerebro({ organizationId: "org_1", ruta: "chat/completions", cuerpoCrudo: "{}", contentType: null }))
      .toEqual({ ok: false, status: 402, code: "tope_mensual", message: "Se alcanzó el tope mensual de IA de este negocio" });
    expect(fetch).not.toHaveBeenCalled(); expect(m.proveedor).not.toHaveBeenCalled();
  });
});
