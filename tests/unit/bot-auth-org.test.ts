import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_API_BUDGET, BOT_AUTH_FAILURES, requireBotKey, resolveBotOrg, resetInstanceOrgCache } from "@/server/bot/auth";
import { credencialDerivada } from "@/server/bot/org-credential";
import { botLastSeenAt, markBotSeen, resetBrainStatusState } from "@/server/bot/status";
import { resetRateLimit } from "@/lib/rate-limit";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const estado = vi.hoisted(() => ({
  negocios: ["org_a"] as string[],
  suspendido: false,
  limite: vi.fn(),
  filtro: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const actual = await original<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => ({
    select: () => ({
      from: () => ({
        limit: (n: number) => {
          estado.limite(n);
          return Promise.resolve(estado.negocios.slice(0, n).map((id) => ({ id })));
        },
        where: (condicion: SQL) => {
          const consulta = new PgDialect().sqlToQuery(condicion);
          estado.filtro(consulta);
          return { limit: (n: number) => Promise.resolve(estado.negocios
            .filter((id) => id === consulta.params[0]).slice(0, n).map((id) => ({ id }))) };
        },
      }),
    }),
  }) };
});
vi.mock("@/server/platform/estado", () => ({
  estadoDeNegocio: async () => estado.suspendido ? "suspended" : "active",
}));

const SECRETO = "0123456789abcdef0123456789abcdef";
function req(org?: string, llave = org === undefined ? SECRETO : credencialDerivada(SECRETO, org), bearer = true) {
  return new Request("http://crm.test/api/bot/profile", { headers: {
    ...(org !== undefined ? { "X-Vocero-Organization": org } : {}),
    ...(bearer ? { Authorization: `Bearer ${llave}` } : { "X-API-Key": llave }),
  } });
}
async function resolver(peticion: Request) {
  const rechazo = requireBotKey(peticion);
  return rechazo ?? resolveBotOrg(peticion);
}
async function error(res: Awaited<ReturnType<typeof resolver>>, status: number, code: string) {
  const respuesta = res instanceof Response ? res : !res.ok ? res.response : null;
  expect(respuesta?.status).toBe(status);
  expect((await respuesta!.json()).error.code).toBe(code);
}

beforeEach(() => {
  vi.stubEnv("BOT_API_KEY", SECRETO);
  vi.stubEnv("PLATAFORMA", "");
  resetRateLimit();
  resetBrainStatusState();
  estado.negocios = ["org_a"];
  estado.suspendido = false;
  estado.limite.mockClear();
  estado.filtro.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("el cerebro queda atado al negocio", () => {
  it.each([true, false])("derivada válida resuelve su organización (Bearer: %s)", async (bearer) => {
    estado.negocios = ["org_b", "org_a"];
    expect(await resolver(req("org_a", undefined, bearer))).toEqual({ ok: true, organizationId: "org_a" });
    expect(estado.filtro).toHaveBeenCalledOnce();
    expect(estado.filtro).toHaveBeenCalledWith(expect.objectContaining({
      sql: '"organization"."id" = $1', params: ["org_a"],
    }));
    expect(botLastSeenAt("org_a")).not.toBeNull();
    expect(botLastSeenAt("org_b")).toBeNull();
  });
  it("una credencial A no autentica B ni acepta el secreto global con cabecera", async () => {
    await error(await resolver(req("org_b", credencialDerivada(SECRETO, "org_a"))), 401, "unauthorized");
    await error(await resolver(req("org_a", SECRETO)), 401, "unauthorized");
    expect(estado.filtro).not.toHaveBeenCalled();
  });
  it("una organización inexistente devuelve el mismo 401 genérico", async () => {
    await error(await resolver(req("org_inexistente")), 401, "unauthorized");
  });
  it("la cabecera vacía no activa el modo heredado", async () => {
    await error(await resolver(req("", SECRETO)), 401, "unauthorized");
  });
  it("heredada con un negocio mantiene el resultado y marca su actividad", async () => {
    expect(await resolver(req())).toEqual({ ok: true, organizationId: "org_a" });
    expect(estado.limite).toHaveBeenCalledWith(2);
    expect(botLastSeenAt("org_a")).not.toBeNull();
  });
  it("sin negocio mantiene el error anterior", async () => {
    estado.negocios = [];
    await error(await resolver(req()), 409, "no_org");
  });
  it("un alta en runtime corta el modo heredado sin invalidar cachés", async () => {
    expect(await resolver(req())).toEqual({ ok: true, organizationId: "org_a" });
    estado.negocios.push("org_b");
    await error(await resolver(req()), 409, "org_ambiguous");
    resetInstanceOrgCache();
    await error(await resolver(req()), 409, "org_ambiguous");
  });
  it.each([undefined, "org_a"])("suspensión corta con plataforma y pasa apagada (%s)", async (org) => {
    estado.suspendido = true;
    vi.stubEnv("PLATAFORMA", "on");
    await error(await resolver(req(org)), 403, "org_suspended");
    vi.stubEnv("PLATAFORMA", "");
    expect(await resolver(req(org))).toEqual({ ok: true, organizationId: "org_a" });
  });
  it("agotar un negocio no consume el presupuesto de otro ni el heredado", () => {
    for (let i = 0; i < BOT_API_BUDGET.max; i++) expect(requireBotKey(req("org_a"))).toBeNull();
    expect(requireBotKey(req("org_a"))?.status).toBe(429);
    expect(requireBotKey(req("org_b"))).toBeNull();
    expect(requireBotKey(req())).toBeNull();
  });
  it("los fallos de credencial derivada usan el freno por IP", () => {
    for (let i = 0; i < BOT_AUTH_FAILURES.max; i++) expect(requireBotKey(req("org_b", "mala"))?.status).toBe(401);
    expect(requireBotKey(req("org_b", "mala"))?.status).toBe(429);
    expect(requireBotKey(req("org_a"))).toBeNull();
  });
  it("la actividad está aislada y conserva las llamadas heredadas", () => {
    markBotSeen("org_a", 100);
    markBotSeen("org_b", 200);
    markBotSeen(300);
    expect(botLastSeenAt("org_a")?.getTime()).toBe(100);
    expect(botLastSeenAt("org_b")?.getTime()).toBe(200);
    expect(botLastSeenAt()?.getTime()).toBe(300);
    expect(botLastSeenAt("org_c")).toBeNull();
    resetBrainStatusState();
    expect(botLastSeenAt("org_a")).toBeNull();
  });
});
