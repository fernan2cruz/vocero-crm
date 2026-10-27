import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), save: vi.fn(), del: vi.fn(),
  public: vi.fn(), secret: vi.fn(), active: vi.fn(), probe: vi.fn(), models: vi.fn(),
  mode: vi.fn(), saldo: vi.fn(), signup: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session, UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { signUpEmail: m.signup } }), runInternalSignup: (fn: () => unknown) => fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
vi.mock("@/server/ai/credentials", () => ({ getAiCredentialPublic: m.public, getAiCredentialSecret: m.secret,
  saveAiCredential: m.save, deleteAiCredential: m.del, marcarActiva: m.active, AiCredentialError: class extends Error {} }));
vi.mock("@/lib/ai/probe", () => ({ probeProvider: m.probe, listModels: m.models }));
vi.mock("@/server/platform/ai-usage", () => ({ modoIaDe: m.mode, proveedorPlataforma: m.provider }));
vi.mock("@/server/platform/credit", () => ({ saldoDe: m.saldo }));

import { gestionadoPorPlataforma } from "@/server/platform/gestionado";
import * as ai from "@/app/api/settings/ai/route";
import { POST as probar } from "@/app/api/settings/ai/test/route";
import { POST as modelos } from "@/app/api/settings/ai/models/route";
import * as team from "@/app/api/settings/team/route";

const datos = { provider: "deepseek", model: "deepseek-chat", token: "secreto-negocio" };
const request = (body: unknown = datos) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PLATAFORMA", "off"); vi.stubEnv("OPENROUTER_API_TOKEN", "");
  m.session.mockResolvedValue({ userId: "u", organizationId: "org", role: "owner" });
  m.public.mockResolvedValue(null); m.secret.mockResolvedValue(null); m.mode.mockResolvedValue("own_key");
  m.probe.mockResolvedValue({ ok: true, latencyMs: 5 });
  m.models.mockResolvedValue({ ok: true, modelos: [{ id: "modelo", nombre: null }] });
});
afterEach(() => vi.unstubAllEnvs());

describe("política de negocio gestionado", () => {
  it("apagada devuelve null sin consultas", () => {
    expect(gestionadoPorPlataforma()).toBeNull();
    expect(m.db).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
  it("encendida devuelve el código y mensaje acordados", async () => {
    vi.stubEnv("PLATAFORMA", "on");
    const res = gestionadoPorPlataforma()!;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "gestionado_por_plataforma", message: "Esto lo administra la plataforma" } });
    expect(m.db).not.toHaveBeenCalled();
  });
  it.each(["put", "delete", "test", "models", "team"])("bloquea %s antes de auth, JSON y base", async (metodo) => {
    vi.stubEnv("PLATAFORMA", "on");
    const req = request(); const json = vi.spyOn(req, "json");
    const res = metodo === "put" ? await ai.PUT(req) : metodo === "delete" ? await ai.DELETE()
      : metodo === "test" ? await probar(req) : metodo === "models" ? await modelos(req) : await team.POST(req);
    expect(res.status).toBe(403); expect(json).not.toHaveBeenCalled();
    for (const fn of Object.values(m)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(["off", "on"])("GET IA y equipo siguen 200 con bandera %s", async (flag) => {
    vi.stubEnv("PLATAFORMA", flag);
    m.db.mockReturnValue({ select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [] }) }) }) });
    const res = await ai.GET(); expect(res.status).toBe(200);
    const vista = await res.json();
    if (flag === "on") expect(vista.plataforma).toEqual({ gestionada: true, modo: "own_key", saldoMicros: null });
    else expect(vista).toEqual({ credencial: null, activa: false, origen: null,
      mensaje: "Tu agente no puede contestar todavía: configura tu proveedor de IA en Ajustes → IA.", respaldoEntorno: null });
    expect(await (await team.GET()).json()).toEqual({ members: [] });
    expect(m.saldo).not.toHaveBeenCalled();
  });
  it("GET expone solo el saldo en modo platform, sin llave global ni últimos cuatro", async () => {
    vi.stubEnv("PLATAFORMA", "on"); m.mode.mockResolvedValue("platform"); m.saldo.mockResolvedValue(123);
    m.provider.mockResolvedValue({ source: "platform", token: "secreto-global-9876", baseUrl: "https://ia.test", model: "m", judgeModel: "m" });
    const res = await ai.GET(); const vista = await res.json();
    expect(vista.plataforma).toEqual({ gestionada: true, modo: "platform", saldoMicros: 123 });
    expect(vista.activa).toBe(true); expect(vista.respaldoEntorno).toBeNull();
    expect(JSON.stringify(vista)).not.toMatch(/secreto-global|9876/);
  });
  it("apagada conserva PUT, DELETE, sonda y modelos", async () => {
    expect((await ai.PUT(request())).status).toBe(200);
    expect(m.save).toHaveBeenCalledWith({ organizationId: "org", ...datos, baseUrl: "https://api.deepseek.com" });
    expect((await ai.DELETE()).status).toBe(200); expect(m.del).toHaveBeenCalledWith("org");
    expect(await (await probar(request())).json()).toEqual({ ok: true, latencyMs: 5, reactivada: false, vista: null });
    expect(await (await modelos(request())).json()).toEqual({ soportado: true, modelos: [{ id: "modelo", nombre: null }] });
  });
  it("apagada conserva validación y el alta del equipo", async () => {
    expect((await ai.PUT(request({}))).status).toBe(422);
    expect((await probar(request({ provider: "deepseek", model: "x" }))).status).toBe(422);
    m.signup.mockResolvedValue({ user: { id: "nuevo" } });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() });
    m.db.mockReturnValue({ insert: () => ({ values }) });
    expect((await team.POST(request({ name: "Ana", email: "ana@example.com", password: "temporal123" }))).status).toBe(201);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org", userId: "nuevo", role: "member" }));
    m.session.mockResolvedValue({ role: "member", organizationId: "org" });
    expect(await (await team.POST(request())).json()).toEqual({ error: { code: "forbidden", message: "Solo el propietario puede crear cuentas" } });
  });
});
