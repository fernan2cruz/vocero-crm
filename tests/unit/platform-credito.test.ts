import { z } from "zod";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.getDb }));
import { schema } from "@/lib/db";
import { acreditar, ajustar, libroDe, saldoDe } from "@/server/platform/credit";
import { registrarUso } from "@/server/platform/ai-usage";
import { creditoSchema } from "@/server/platform/schemas";
import * as proveedor from "@/lib/ai/provider";
import { pensarPorElCerebro } from "@/server/bot/llm-proxy";
import { chatJson } from "@/lib/ai";

type Asiento = typeof schema.aiCreditLedger.$inferInsert;
type Consumo = typeof schema.aiUsage.$inferInsert;
type Auditoria = typeof schema.platformAudit.$inferInsert;
let saldo: number | undefined;
let libro: Asiento[];
let usos: Consumo[];
let auditoria: Auditoria[];
let fallo: "libro" | "uso" | "auditoria" | null;
const incrementos: string[] = [];
const db = {
  insert: (tabla: unknown) => ({ values: (valores: Record<string, unknown>) => {
    if (tabla === schema.aiCreditAccount) return {
      onConflictDoUpdate: (config: { set: { balanceMicros: Parameters<PgDialect["sqlToQuery"]>[0] } }) => ({
        returning: async () => {
          const consulta = new PgDialect().sqlToQuery(config.set.balanceMicros);
          incrementos.push(consulta.sql);
          expect(consulta.params).toEqual([valores.balanceMicros]);
          saldo = (saldo ?? 0) + Number(valores.balanceMicros);
          return [{ balanceMicros: saldo }];
        },
      }),
    };
    if (tabla === schema.aiCreditLedger) {
      if (fallo === "libro") throw new Error("fallo simulado");
      libro.push(valores as Asiento);
    } else if (tabla === schema.aiUsage) {
      if (fallo === "uso") throw new Error("fallo simulado");
      usos.push(valores as Consumo);
    } else if (tabla === schema.platformAudit) {
      if (fallo === "auditoria") throw new Error("fallo simulado");
      auditoria.push(valores as Auditoria);
    }
    return Promise.resolve();
  } }),
  select: () => ({ from: (tabla: unknown) => ({ where: () => {
    const resultado = tabla === schema.aiCreditAccount ? (saldo === undefined ? [] : [{ balanceMicros: saldo }])
      : tabla === schema.aiModelPrice ? [{ model: "m", updatedAt: new Date(), inputPerMillionMicros: 1_000_000, outputPerMillionMicros: 2_000_000 }] : libro;
    return { limit: async () => resultado,
      orderBy: () => ({ limit: async (limit: number) => [...resultado].reverse().slice(0, limit) }) };
  } }) }),
  transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const antes = { saldo, libro: [...libro], usos: [...usos], auditoria: [...auditoria] };
    try { return await fn(db); } catch (error) {
      saldo = antes.saldo; libro = antes.libro; usos = antes.usos; auditoria = antes.auditoria;
      throw error;
    }
  },
};
const movimiento = { organizationId: "org_1", amountMicros: 100, note: "Recarga manual", actorUserId: "admin" };
beforeEach(() => {
  saldo = undefined; libro = []; usos = []; auditoria = []; fallo = null; incrementos.length = 0;
  mocks.getDb.mockReset().mockReturnValue(db); vi.stubEnv("PLATAFORMA", "on");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("libro de crédito con base simulada", () => {
  it("sin cuenta el saldo es cero; recarga, ajuste y uso reconcilian el libro", async () => {
    expect(await saldoDe("org_1")).toBe(0);
    expect(await acreditar(movimiento)).toBe(100);
    expect(await ajustar({ ...movimiento, amountMicros: -40 })).toBe(60);
    await registrarUso({ organizationId: "org_1", source: "bot", model: "m", cobrar: true,
      uso: { promptTokens: 10, completionTokens: 30 } });
    expect(await saldoDe("org_1")).toBe(-10);
    expect(libro.map((a) => [a.kind, a.amountMicros, a.balanceAfter])).toEqual([
      ["grant", 100, 100], ["adjust", -40, 60], ["usage", -70, -10],
    ]);
    expect(libro[2]?.ref).toBe(usos[0]?.id);
    expect(auditoria.map((a) => a.action)).toEqual(["credit.adjust", "credit.adjust"]);
    expect(auditoria[0]?.detail).toEqual({ kind: "grant", amountMicros: 100, balanceAfter: 100, note: "Recarga manual" });
    expect(incrementos.every((sql) => sql.includes('"ai_credit_account"."balance_micros" + $1'))).toBe(true);
  });
  it("acepta ajustes negativos y limita el libro a 200", async () => {
    await ajustar({ ...movimiento, amountMicros: -1 });
    expect(saldo).toBe(-1);
    for (let i = 0; i < 205; i++) await acreditar(movimiento);
    expect(await libroDe("org_1", { limit: 500 })).toHaveLength(200);
    expect((await libroDe("org_1", { limit: 1 }))[0]?.balanceAfter).toBe(saldo);
  });
  it.each(["libro", "auditoria"] as const)("revierte la recarga si falla %s", async (etapa) => {
    fallo = etapa;
    await expect(acreditar(movimiento)).rejects.toThrow();
    expect(saldo).toBeUndefined(); expect(libro).toEqual([]); expect(auditoria).toEqual([]);
  });
  it.each(["libro", "uso"] as const)("revierte el cobro si falla %s y no propaga el fallo", async (etapa) => {
    saldo = 10; fallo = etapa;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await registrarUso({ organizationId: "org_1", source: "judge", model: "m", cobrar: true,
      uso: { promptTokens: 10, completionTokens: 10 } });
    expect(saldo).toBe(10); expect(libro).toEqual([]); expect(usos).toEqual([]);
    expect(log).toHaveBeenCalledWith("[platform] No se pudo registrar el consumo de IA");
  });
  it("costo cero y own_key solo insertan consumo; apagada no accede a BD", async () => {
    const input = { organizationId: "org_1", source: "lab" as const, model: "m", cobrar: true,
      uso: { promptTokens: 1, completionTokens: 1, costoUsd: 0 } };
    await registrarUso(input);
    await registrarUso({ ...input, cobrar: false, uso: { ...input.uso, costoUsd: 1 } });
    expect(usos.map((u) => u.costMicros)).toEqual([0, 1_000_000]);
    expect(saldo).toBeUndefined(); expect(libro).toEqual([]);
    mocks.getDb.mockClear(); vi.stubEnv("PLATAFORMA", "off");
    await registrarUso(input); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rechaza montos inseguros, cero, grants negativos y notas inválidas", async () => {
    for (const amountMicros of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(acreditar({ ...movimiento, amountMicros })).rejects.toThrow();
    }
    await expect(ajustar({ ...movimiento, note: "  " })).rejects.toThrow();
    expect(creditoSchema.safeParse({ action: "adjust", amountMicros: 1, note: "x".repeat(201) }).success).toBe(false);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("revierte si el saldo acumulado excede la precisión segura", async () => {
    saldo = Number.MAX_SAFE_INTEGER;
    await expect(acreditar({ ...movimiento, amountMicros: 1 })).rejects.toThrow();
    expect(saldo).toBe(Number.MAX_SAFE_INTEGER); expect(libro).toEqual([]);
  });
});

describe("ganchos de consumo conservan la respuesta", () => {
  function proveedorFalso(source: "org" | "platform" = "platform") {
    vi.spyOn(proveedor, "resolveAiProvider").mockResolvedValue({ ok: true, provider: {
      source, model: "configurado", judgeModel: "juez", token: "secreto", baseUrl: "https://ia.test",
    } });
  }
  const input = { organizationId: "org_1", ruta: "chat/completions", cuerpoCrudo: '{"model":"pedido"}', contentType: "application/json" };
  it("el proxy conserva bytes SSE y cobra el modelo efectivo", async () => {
    proveedorFalso(); saldo = 100;
    const cuerpo = 'data: {"model":"efectivo","usage":{"prompt_tokens":2,"completion_tokens":3,"cost":0.000007}}\n\ndata: [DONE]\n\n';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cuerpo, { headers: { "content-type": "text/event-stream" } })));
    expect(await pensarPorElCerebro(input)).toEqual({ ok: true, status: 200, cuerpo, contentType: "text/event-stream" });
    expect(usos[0]).toMatchObject({ source: "bot", model: "efectivo", costMicros: 7 }); expect(saldo).toBe(93);
  });
  it("si medir falla el proxy devuelve exactamente la respuesta del proveedor", async () => {
    proveedorFalso(); fallo = "uso"; saldo = 100;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cuerpo = '{"usage":{"prompt_tokens":2,"completion_tokens":3}}';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(cuerpo)));
    expect(await pensarPorElCerebro(input)).toMatchObject({ ok: true, status: 200, cuerpo });
    expect(saldo).toBe(100); expect(usos).toEqual([]);
  });
  it("apagada el proxy no consulta la base aunque haya usage", async () => {
    proveedorFalso(); vi.stubEnv("PLATAFORMA", "off");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ usage: { prompt_tokens: 1, completion_tokens: 1 } })));
    await pensarPorElCerebro(input); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("un 402 con llave de plataforma no escribe ni pausa la credencial del negocio", async () => {
    proveedorFalso();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rechazada", { status: 402 })));
    expect(await pensarPorElCerebro(input)).toMatchObject({ ok: true, status: 402, cuerpo: "rechazada" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("sin saldo el proxy no llama al proveedor y responde 402", async () => {
    vi.spyOn(proveedor, "resolveAiProvider").mockResolvedValue(proveedor.resolverPlataforma({
      source: "platform", model: "m", judgeModel: "m", token: "secreto", baseUrl: "https://ia.test",
    }, 0));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await pensarPorElCerebro(input)).toMatchObject({ ok: false, status: 402, code: "sin_credencial" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([true, false])("chatJson mide cada intento, judge=%s", async (judge) => {
    proveedorFalso("org");
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "inválido" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    vi.stubGlobal("fetch", fetch);
    expect(await chatJson(z.object({ ok: z.boolean() }), [], { organizationId: "org_1", judge }))
      .toEqual({ ok: true, data: { ok: true }, raw: '{"ok":true}' });
    expect(usos.map((u) => u.source)).toEqual([judge ? "judge" : "lab", judge ? "judge" : "lab"]);
    expect(saldo).toBeUndefined(); expect(libro).toEqual([]);
  });
  it("un reintento de plataforma no gasta si el intento anterior agotó el crédito", async () => {
    const provider = { source: "platform" as const, model: "m", judgeModel: "m", token: "secreto", baseUrl: "https://ia.test" };
    saldo = 1;
    vi.spyOn(proveedor, "resolveAiProvider").mockImplementation(async () => proveedor.resolverPlataforma(provider, saldo ?? 0));
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: "inválido" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    vi.stubGlobal("fetch", fetch);
    expect(await chatJson(z.object({ ok: z.boolean() }), [], { organizationId: "org_1" })).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetch).toHaveBeenCalledTimes(1); expect(saldo).toBe(-2);
  });
});
