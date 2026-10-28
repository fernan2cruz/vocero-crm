import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sesion: vi.fn(), admin: vi.fn(), negocio: vi.fn(), limites: vi.fn(), uso: vi.fn(), fijar: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: m.sesion } }) }));
vi.mock("@/server/platform/admins", () => ({ esSuperadmin: m.admin }));
vi.mock("@/server/platform/tenants", () => ({ obtenerNegocio: m.negocio }));
vi.mock("@/server/platform/limites", () => ({ limitesDe: m.limites, usoActualDe: m.uso, fijarLimites: m.fijar }));
import { GET, PUT } from "@/app/api/platform/tenants/[id]/limits/route";
const datos = { maxMessagesPerDay: 500, maxCampaignRecipients: null, maxMonthlySpendMicros: 1_000_000 };
const contexto = { params: Promise.resolve({ id: "org_1" }) };
const request = (body: unknown = datos) => new Request("http://localhost/api/platform/tenants/org_1/limits", { method: "PUT", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PLATAFORMA", "on");
  m.sesion.mockResolvedValue({ user: { id: "actor", email: "actor@example.test" } });
  m.admin.mockResolvedValue(true); m.negocio.mockResolvedValue({ id: "org_1" });
  m.limites.mockResolvedValue(datos); m.uso.mockResolvedValue({ mensajesHoy: 120, gastoMesMicros: 2 }); m.fijar.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());
describe("GET y PUT de límites: solo superadmin", () => {
  it.each([GET, PUT])("apagada responde 404 sin auth ni dominio", async (handler) => {
    vi.stubEnv("PLATAFORMA", "off");
    expect((await handler(request(), contexto)).status).toBe(404);
    for (const fn of Object.values(m)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([GET, PUT])("sin sesión 401; propietario del negocio sin superadmin 404", async (handler) => {
    m.sesion.mockResolvedValue(null); expect((await handler(request(), contexto)).status).toBe(401);
    m.sesion.mockResolvedValue({ user: { id: "propietario", email: "dueno@example.test" } }); m.admin.mockResolvedValue(false);
    expect((await handler(request(), contexto)).status).toBe(404);
    expect(m.limites).not.toHaveBeenCalled(); expect(m.uso).not.toHaveBeenCalled(); expect(m.fijar).not.toHaveBeenCalled();
  });
  it("GET muestra límites y uso del id explícito", async () => {
    const respuesta = await GET(request(), contexto);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ limites: datos, uso: { mensajesHoy: 120, gastoMesMicros: 2 } });
    expect(m.limites).toHaveBeenCalledWith("org_1"); expect(m.uso).toHaveBeenCalledWith("org_1");
  });
  it("PUT valida y pasa el actor de la sesión a la transacción", async () => {
    expect((await PUT(request({ ...datos, maxMessagesPerDay: 0 }), contexto)).status).toBe(422);
    expect(m.fijar).not.toHaveBeenCalled();
    expect((await PUT(request(), contexto)).status).toBe(200);
    expect(m.fijar).toHaveBeenCalledWith("org_1", datos, "actor");
    m.fijar.mockResolvedValue(false); expect((await PUT(request(), contexto)).status).toBe(404);
    m.negocio.mockResolvedValue(null); expect((await GET(request(), contexto)).status).toBe(404);
  });
});
