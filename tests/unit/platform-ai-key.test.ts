import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ negocio: vi.fn(), public: vi.fn(), secret: vi.fn(), save: vi.fn(), del: vi.fn(), audit: vi.fn(), probe: vi.fn() }));
const tx = vi.hoisted(() => ({}));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(),
  getDb: () => ({ transaction: (fn: (transaction: object) => Promise<unknown>) => fn(tx) }) }));
vi.mock("@/server/platform/guard", () => ({ withSuperadmin: (fn: (s: { userId: string }, ...args: unknown[]) => Promise<Response>) =>
  (...args: unknown[]) => fn({ userId: "superadmin" }, ...args) }));
vi.mock("@/server/platform/tenants", () => ({ obtenerNegocio: m.negocio }));
vi.mock("@/server/platform/audit", () => ({ auditar: m.audit }));
vi.mock("@/server/ai/credentials", async (original) => ({ ...await original<typeof import("@/server/ai/credentials")>(),
  getAiCredentialPublic: m.public, getAiCredentialSecret: m.secret, saveAiCredential: m.save, deleteAiCredential: m.del }));
vi.mock("@/lib/ai/probe", () => ({ probeProvider: m.probe }));

import { GET, PUT, DELETE } from "@/app/api/platform/tenants/[id]/ai-key/route";
import { POST } from "@/app/api/platform/tenants/[id]/ai-key/test/route";
import { AiCredentialError } from "@/server/ai/credentials";
import { aiSettingsPutSchema } from "@/server/ai/settings";

const token = "secreto-negocio-1234";
const datos = { provider: "deepseek", model: "deepseek-chat", token };
const cred = { provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com",
  tokenLast4: "1234", status: "active", statusReason: null, statusChangedAt: null, updatedAt: new Date() };
const vista = { configurada: true, provider: cred.provider, model: cred.model, baseUrl: cred.baseUrl, last4: "1234", estado: "active" };
const ctx = { params: Promise.resolve({ id: "otro-negocio" }) };
const request = (body: unknown = datos) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); m.negocio.mockResolvedValue({ id: "otro-negocio" }); m.public.mockResolvedValue(cred);
  m.secret.mockResolvedValue({ ...cred, token }); m.save.mockResolvedValue(cred);
  m.probe.mockResolvedValue({ ok: true, latencyMs: 7 });
});

describe("PL-8: llave de IA por negocio", () => {
  it.each([GET, PUT, DELETE, POST])("negocio ausente devuelve 404 sin consultar llaves ni leer cuerpo", async (handler) => {
    m.negocio.mockResolvedValue(null); const req = request(); const json = vi.spyOn(req, "json");
    expect((await handler(req, ctx)).status).toBe(404); expect(json).not.toHaveBeenCalled();
    expect(m.public).not.toHaveBeenCalled(); expect(m.secret).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled(); expect(m.del).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("GET selecciona metadatos de ESE negocio y jamás devuelve token o motivo", async () => {
    m.public.mockResolvedValue({ ...cred, token, statusReason: token });
    expect(await (await GET(request(), ctx)).json()).toEqual(vista);
    expect(m.public).toHaveBeenCalledWith("otro-negocio"); expect(m.secret).not.toHaveBeenCalled();
  });
  it("GET sin llave conserva la forma pública con nulls", async () => {
    m.public.mockResolvedValue(null);
    expect(await (await GET(request(), ctx)).json()).toEqual({ configurada: false, provider: null, baseUrl: null, model: null, last4: null, estado: null });
  });
  it("PUT guarda y audita solo campos explícitos sin token", async () => {
    const res = await PUT(request(), ctx); expect(res.status).toBe(200); expect(await res.json()).toEqual(vista);
    expect(m.save).toHaveBeenCalledWith({ organizationId: "otro-negocio", ...datos, baseUrl: cred.baseUrl }, tx);
    expect(m.audit).toHaveBeenCalledWith({ actorUserId: "superadmin", action: "ai_key.set", organizationId: "otro-negocio",
      targetUserId: null, detail: { scope: "org", provider: cred.provider, model: cred.model, last4: "1234" } }, tx);
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(token);
  });
  it("PUT sin token cambia modelo sin inventar una llave", async () => {
    const body = { provider: "deepseek", model: "otro" };
    expect((await PUT(request(body), ctx)).status).toBe(200);
    expect(m.save).toHaveBeenCalledWith({ organizationId: "otro-negocio", ...body, baseUrl: cred.baseUrl }, tx);
    m.audit.mockClear(); m.save.mockRejectedValue(new AiCredentialError("sin_token"));
    expect((await PUT(request(body), ctx)).status).toBe(422); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([{}, { ...datos, token: "corto" }, { ...datos, provider: "desconocido" }, { ...datos, provider: "openai_compatible" }])("PUT rechaza input inválido %j", async (body) => {
    expect((await PUT(request(body), ctx)).status).toBe(422); expect(m.save).not.toHaveBeenCalled();
  });
  it("reutiliza el esquema con DeepSeek y base http(s) obligatoria para compatible", () => {
    expect(aiSettingsPutSchema.safeParse(datos).success).toBe(true);
    expect(aiSettingsPutSchema.safeParse({ provider: "openai_compatible", baseUrl: "ftp://ia.test", model: "x" }).success).toBe(false);
    expect(aiSettingsPutSchema.safeParse({ provider: "openai_compatible", baseUrl: "https://ia.test", model: "x" }).success).toBe(true);
  });
  it("DELETE revoca solo ESE negocio y lo audita", async () => {
    const res = await DELETE(request(), ctx); expect(res.status).toBe(200);
    expect(m.del).toHaveBeenCalledWith("otro-negocio", tx);
    expect(m.audit).toHaveBeenCalledWith({ actorUserId: "superadmin", action: "ai_key.revoke", organizationId: "otro-negocio",
      targetUserId: null, detail: { scope: "org" } }, tx);
    expect((await res.json()).configurada).toBe(false);
  });
  it.each([true, false])("sonda usa token escrito (%s) o guardado sin guardar ni auditar", async (escrito) => {
    const body = escrito ? { ...datos, token: "llave-escrita" } : { provider: datos.provider, model: datos.model };
    const res = await POST(request(body), ctx);
    expect(await res.json()).toEqual({ ok: true, latencyMs: 7 });
    expect(m.probe).toHaveBeenCalledWith({ baseUrl: cred.baseUrl, model: datos.model, token: escrito ? "llave-escrita" : token });
    if (escrito) expect(m.secret).not.toHaveBeenCalled(); else expect(m.secret).toHaveBeenCalledWith("otro-negocio");
    expect(m.save).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("sonda sin llave devuelve 422 sin contactar proveedor", async () => {
    m.secret.mockResolvedValue(null);
    expect((await POST(request({ provider: "deepseek", model: "m" }), ctx)).status).toBe(422);
    expect(m.probe).not.toHaveBeenCalled();
  });
  it.each(["invalid_token", "no_credit", "timeout", "unreachable", "provider_error"])("sonda sanea error %s sin repetir secretos", async (code) => {
    m.probe.mockResolvedValue({ ok: false, code, httpStatus: 401, message: `rechazó ${token}` });
    const res = await POST(request(), ctx);
    expect(res.status).toBe(["timeout", "unreachable", "provider_error"].includes(code) ? 503 : 422);
    expect(await res.text()).not.toContain(token); expect(m.save).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
});
