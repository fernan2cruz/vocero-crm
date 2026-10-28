import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ public: vi.fn(), secret: vi.fn(), db: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), saldo: vi.fn() }));
vi.mock("@/server/ai/credentials", () => ({ getAiCredentialPublic: mocks.public, getAiCredentialSecret: mocks.secret }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.db }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: mocks.decrypt, encryptSecret: mocks.encrypt }));
vi.mock("@/server/platform/credit", () => ({ saldoDe: mocks.saldo }));
import { estadoIaDe, mensajeDeEstado, resolveAiProvider, resolverPlataforma, type AiProvider } from "@/lib/ai/provider";
import { ajustesIaPlataforma, guardarIaPlataforma } from "@/server/platform/ai-usage";
import { schema } from "@/lib/db";
import { aiSettingsPutSchema, baseUrlEfectiva } from "@/server/ai/settings";

const provider: AiProvider = { source: "platform", token: "llave-plataforma", model: "modelo", judgeModel: "modelo", baseUrl: "https://ia.test" };
const fila = { aiBaseUrl: provider.baseUrl, aiModel: provider.model, tokenCipher: "c", tokenIv: "i", tokenTag: "t" };
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on");
  vi.stubEnv("OPENROUTER_API_TOKEN", "");
  mocks.public.mockReset().mockResolvedValue(null);
  mocks.secret.mockReset().mockResolvedValue(null);
  mocks.db.mockReset(); mocks.saldo.mockReset(); mocks.decrypt.mockReset().mockReturnValue(provider.token);
  mocks.encrypt.mockReset().mockReturnValue({ cipher: "cifrado", iv: "iv", tag: "tag" });
});
afterEach(() => vi.unstubAllEnvs());
function consultas(...resultados: unknown[][]) {
  mocks.db.mockReturnValue({ select: () => ({ from: (tabla: unknown) => ({ where: () => ({
    limit: async () => tabla === schema.organizationLimits ? [] : resultados.shift(),
  }) }) }) });
}
describe("resolución de IA de plataforma", () => {
  it.each([1, 100_000])("con llave y saldo %s resuelve plataforma", (saldo) => {
    expect(resolverPlataforma(provider, saldo)).toEqual({ ok: true, provider });
  });
  it.each([0, -1, -1000])("con saldo %s pausa sin respaldo", (saldo) => {
    expect(resolverPlataforma(provider, saldo)).toMatchObject({ ok: false, estado: { motivo: "sin_saldo", plataforma: true } });
  });
  it.each([0, 1, -1])("sin llave y saldo %s queda sin configurar", (saldo) => {
    expect(resolverPlataforma(null, saldo)).toEqual({ ok: false, estado: { activa: false, motivo: "sin_configurar" } });
  });
  it("apagada no consulta tablas de plataforma ni saldo", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    expect(await resolveAiProvider("org")).toEqual({ ok: false, estado: { activa: false, motivo: "sin_configurar" } });
    expect(await estadoIaDe("org")).toEqual({ activa: false, motivo: "sin_configurar" });
    expect(mocks.secret).toHaveBeenCalledWith("org");
    expect(mocks.public).toHaveBeenCalledWith("org");
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.saldo).not.toHaveBeenCalled();
  });
  it("own_key y ausencia de fila usan la resolución anterior", async () => {
    consultas([{ aiMode: "own_key" }], []);
    vi.stubEnv("OPENROUTER_API_TOKEN", "llave-entorno"); vi.stubEnv("OPENROUTER_MODEL", "modelo");
    expect(await resolveAiProvider("org")).toMatchObject({ ok: true, provider: { source: "env" } });
    expect(await resolveAiProvider("org")).toMatchObject({ ok: true, provider: { source: "env" } });
    expect(mocks.saldo).not.toHaveBeenCalled(); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("platform ignora llave de negocio y entorno y vuelve solo tras recargar", async () => {
    consultas([{ aiMode: "platform" }], [fila], [{ aiMode: "platform" }], [fila]);
    mocks.saldo.mockResolvedValueOnce(0).mockResolvedValueOnce(10);
    const primero = await resolveAiProvider("org");
    expect(primero).toMatchObject({ ok: false, estado: { motivo: "sin_saldo" } });
    if (!primero.ok) expect(mensajeDeEstado(primero.estado)).toBe("Tu agente está pausado: se agotó el crédito de IA. Contacta a quien administra tu plataforma.");
    expect(await resolveAiProvider("org")).toEqual({ ok: true, provider });
    expect(mocks.secret).not.toHaveBeenCalled();
    expect(mocks.saldo).toHaveBeenCalledTimes(2);
  });
  it("estado consulta el mismo saldo sin exponer el token", async () => {
    consultas([{ aiMode: "platform" }], [fila]); mocks.saldo.mockResolvedValue(-1);
    const estado = await estadoIaDe("org");
    expect(estado).toMatchObject({ activa: false, motivo: "sin_saldo", plataforma: true });
    expect(JSON.stringify(estado)).not.toContain(provider.token);
  });
  it("la vista de la llave solo publica metadatos y last4", async () => {
    consultas([{ ...fila, aiProvider: "deepseek", tokenLast4: "1234" }]);
    expect(await ajustesIaPlataforma()).toEqual({ provider: "deepseek", baseUrl: provider.baseUrl,
      model: provider.model, last4: "1234", configurada: true });
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("guardar cifra la llave y audita únicamente los últimos cuatro", async () => {
    const escrituras: { tabla: unknown; valores: Record<string, unknown> }[] = [];
    const tx = { insert: (tabla: unknown) => ({ values: (valores: Record<string, unknown>) => {
      escrituras.push({ tabla, valores });
      return { onConflictDoUpdate: async () => {} };
    } }) };
    mocks.db.mockReturnValue({ transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) });
    const token = "llave-secreta-1234";
    expect(await guardarIaPlataforma({ provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", token }, "admin")).toBe(true);
    expect(mocks.encrypt).toHaveBeenCalledWith(token);
    expect(escrituras[0]).toMatchObject({ tabla: schema.platformSettings, valores: { tokenCipher: "cifrado", tokenIv: "iv", tokenTag: "tag", tokenLast4: "1234" } });
    expect(escrituras[1]).toMatchObject({ tabla: schema.platformAudit, valores: { action: "ai_key.set", organizationId: null,
      detail: { scope: "platform", last4: "1234" } } });
    expect(JSON.stringify(escrituras.map((e) => e.valores))).not.toContain(token);
  });
  it("sin token conserva las columnas cifradas y permite cambiar modelo", async () => {
    const cambios: Record<string, unknown>[] = [];
    const tx = { update: () => ({ set: (valores: Record<string, unknown>) => {
      cambios.push(valores);
      return { where: () => ({ returning: async () => [{ tokenLast4: "1234" }] }) };
    } }), insert: () => ({ values: async () => {} }) };
    mocks.db.mockReturnValue({ transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) });
    expect(await guardarIaPlataforma({ provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "otro" }, "admin")).toBe(true);
    expect(cambios[0]).toMatchObject({ aiModel: "otro" });
    expect(cambios[0]).not.toHaveProperty("tokenCipher"); expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it("reutiliza el preset DeepSeek y exige base URL para proveedores genéricos", () => {
    expect(aiSettingsPutSchema.safeParse({ provider: "deepseek", model: "deepseek-chat" }).success).toBe(true);
    expect(baseUrlEfectiva("deepseek", "https://ignorada.test")).toBe("https://api.deepseek.com");
    expect(aiSettingsPutSchema.safeParse({ provider: "openai_compatible", model: "m" }).success).toBe(false);
  });
});
