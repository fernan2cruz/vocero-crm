import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const sim = vi.hoisted(() => ({ tablas: new Map<string, unknown[][]>(), consultas: [] as string[],
  ejecutadas: [] as unknown[], filtros: [] as unknown[], productividad: [] as unknown[], autorizado: true }));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return { schema, getDb: () => ({
    select: () => {
      let filas: unknown[] = [];
      const q = { from: (tabla: Parameters<typeof getTableName>[0]) => {
        const nombre = getTableName(tabla); sim.consultas.push(nombre);
        filas = sim.tablas.get(nombre)?.shift() ?? []; return q;
      }, leftJoin: () => q, where: (filtro: unknown) => { sim.filtros.push(filtro); return q; }, groupBy: () => q, orderBy: () => q,
      then: (resolve: (valor: unknown[]) => unknown) => Promise.resolve(resolve(filas)) };
      return q;
    },
    execute: async (consulta: unknown) => { sim.ejecutadas.push(consulta); return sim.productividad; },
  }) };
});
vi.mock("@/server/platform/guard", () => ({
  withSuperadmin: (handler: (s: { userId: string; email: string }, r: Request) => Promise<Response>) =>
    (req: Request) => sim.autorizado ? handler({ userId: "admin", email: "a@test.test" }, req) : Promise.resolve(new Response(null, { status: 401 })),
}));
vi.mock("@/server/bot/status", () => ({ botLastSeenAt: () => null }));

import { GET as usage } from "@/app/api/platform/usage/route";
import { GET as overview } from "@/app/api/platform/overview/route";
import { GET as productivity } from "@/app/api/platform/productivity/route";
import { GET as exportar } from "@/app/api/platform/usage/export/route";
import { resolverPeriodo } from "@/server/platform/periodo";
import { consumoPorNegocio } from "@/server/platform/consumo";
import { productividadPorNegocio } from "@/server/platform/productividad";

const negocio = { organizationId: "org_a", nombre: '=SUM(1,2) "Ñ"', aiMode: "platform", saldo: 15 };
const vacio = { organizationId: "org_b", nombre: "Sin uso", aiMode: "own_key", saldo: 100 };
const datos = [{ organizationId: "org_a", source: "bot", llamadas: 2, tokensEntrada: 20, tokensSalida: 10, costoMicros: 1234567 },
  { organizationId: "org_a", source: "judge", llamadas: 1, tokensEntrada: 5, tokensSalida: 3, costoMicros: 1 }];
const url = "http://localhost/api/platform/informe?from=2024-02-28&to=2024-03-01";
function sembrar() {
  sim.tablas.set("organization", [[negocio, vacio]]);
  sim.tablas.set("ai_usage", [datos]);
}
beforeEach(() => {
  sim.tablas.clear(); sim.consultas.length = 0; sim.ejecutadas.length = 0; sim.filtros.length = 0; sim.productividad = []; sim.autorizado = true;
  sembrar();
});

describe("informes con base simulada", () => {
  it("consumo incluye ceros, fuentes, saldo solo platform y orden por costo", async () => {
    const filas = await consumoPorNegocio(resolverPeriodo({ from: "2024-02-28", to: "2024-03-01" }));
    expect(filas).toEqual([
      { organizationId: "org_a", nombre: negocio.nombre, aiMode: "platform", saldoMicros: 15, llamadas: 3,
        tokensEntrada: 25, tokensSalida: 13, costoMicros: 1234568,
        porFuente: { bot: { llamadas: 2, costoMicros: 1234567 }, lab: { llamadas: 0, costoMicros: 0 }, judge: { llamadas: 1, costoMicros: 1 } } },
      { organizationId: "org_b", nombre: "Sin uso", aiMode: "own_key", saldoMicros: null, llamadas: 0,
        tokensEntrada: 0, tokensSalida: 0, costoMicros: 0,
        porFuente: { bot: { llamadas: 0, costoMicros: 0 }, lab: { llamadas: 0, costoMicros: 0 }, judge: { llamadas: 0, costoMicros: 0 } } },
    ]);
    expect(sim.consultas).toEqual(["organization", "ai_usage"]);
  });
  it("usage conserva negocios, modelos y serie continua con ceros", async () => {
    sim.tablas.set("ai_usage", [datos, [{ model: "modelo", llamadas: 3, tokensEntrada: 25, tokensSalida: 13, costoMicros: 1234568 }],
      [{ dia: "2024-02-29", llamadas: 3, costoMicros: 1234568 }]]);
    const res = await usage(new Request(`${url}&organizationId=org_a`));
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.periodo).toEqual({ desde: "2024-02-28T00:00:00.000Z", hasta: "2024-03-02T00:00:00.000Z", dias: 3 });
    expect(body.negocios).toHaveLength(2); expect(body.modelos[0].model).toBe("modelo");
    expect(body.serie).toEqual([{ dia: "2024-02-28", llamadas: 0, costoMicros: 0 },
      { dia: "2024-02-29", llamadas: 3, costoMicros: 1234568 }, { dia: "2024-03-01", llamadas: 0, costoMicros: 0 }]);
    expect(sim.consultas.filter((t) => t === "ai_usage")).toHaveLength(3);
    const filtros = sim.filtros.map((f) => new PgDialect().sqlToQuery(f as SQL));
    expect(filtros.filter((f) => f.params.includes("org_a"))).toHaveLength(2);
    for (const f of filtros.filter((f) => f.params.includes("org_a"))) expect(f.sql).toContain('"ai_usage"."organization_id" =');
  });
  it("CSV real lleva BOM, decimales, fuentes y fórmulas neutralizadas", async () => {
    const res = await exportar(new Request(url));
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain("consumo.csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('"\'=SUM(1,2) ""Ñ""",3,25,13,1.234568,2,1.234567,0,0.000000,1,0.000001\r\n');
    expect(csv).toContain("Sin uso,0,0,0,0.000000");
  });
  it("overview suma consumo, usuarios y saldos y acumula riesgos por id", async () => {
    sim.tablas.set("organization", [[negocio, vacio], [{ organizationId: "org_a", status: "suspended", enabled: true },
      { organizationId: "org_b", status: null, enabled: false }]]);
    sim.tablas.set("user", [[{ n: 7 }]]);
    sim.tablas.set("ai_credit_ledger", [[{ organizationId: "org_a", total: 100 }]]);
    sim.tablas.set("webhook_event", [[{ organizationId: "org_a", n: 2 }]]);
    sim.tablas.set("ai_credit_account", [[{ organizationId: "org_a", saldo: 15 }, { organizationId: "org_b", saldo: 100 }]]);
    const res = await overview(new Request(url)); const body = await res.json();
    expect(body.negocios).toEqual({ activos: 1, suspendidos: 1 }); expect(body.usuarios).toBe(7);
    expect(body.consumo).toEqual({ llamadas: 3, costoMicros: 1234568 }); expect(body.creditoTotalMicros).toBe(115);
    expect(body.topConsumo[0]).toEqual({ organizationId: "org_a", nombre: negocio.nombre, costoMicros: 1234568 });
    expect(body.enRiesgo).toEqual([
      { organizationId: "org_a", nombre: negocio.nombre, motivos: ["credito_bajo", "webhooks_agotados", "suspendido", "cerebro_sin_senal"] },
      { organizationId: "org_b", nombre: vacio.nombre, motivos: ["agente_apagado"] },
    ]);
  });
  it("productivity devuelve filas agregadas, filtra id sin consultas adicionales", async () => {
    sim.productividad = [{ organizationId: "org_a", nombre: "A", conversaciones: 2 }, { organizationId: "org_b", nombre: "B", conversaciones: 0 }];
    const res = await productivity(new Request(`${url}&organizationId=org_b`));
    expect(await res.json()).toMatchObject({ negocios: [{ organizationId: "org_b", conversaciones: 0 }] });
    expect(sim.ejecutadas).toHaveLength(1);
  });
  it("SQL agrupa sin contenido, excluye laboratorio y usa mediana de respuestas posteriores", async () => {
    await productividadPorNegocio(resolverPeriodo({ days: 1 }));
    const q = new PgDialect().sqlToQuery(sim.ejecutadas[0] as SQL);
    expect(q.sql).toContain("percentile_cont(0.5)"); expect(q.sql).toContain("m.created_at > i.entrada");
    expect(q.sql).toContain("not c.is_test"); expect(q.sql).toContain("not b.is_test");
    expect(q.sql).toContain("not e.approximate"); expect(q.sql).toContain("v.organization_id, v.currency");
    expect(q.sql).not.toMatch(/m\.text|payload|token_cipher|contact\.name|select\s+\*/i);
  });
  it.each([usage, overview, productivity, exportar])("rechaza periodo inválido antes de consultar", async (get) => {
    const res = await get(new Request(`${url}&days=367`));
    expect(res.status).toBe(422); expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error.message).toContain("366"); expect(sim.consultas).toEqual([]);
  });
  it.each(["days=", "days=2.5", "days=no", "organizationId="])("valida query externa %s", async (p) => {
    expect((await usage(new Request(`${url}&${p}`))).status).toBe(422);
  });
  it("mantiene no-store y no consulta al denegar la guardia", async () => {
    sim.autorizado = false;
    const res = await usage(new Request(url));
    expect(res.status).toBe(401); expect(res.headers.get("cache-control")).toBe("no-store"); expect(sim.consultas).toEqual([]);
  });
});
