import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ status: vi.fn(), mode: vi.fn(), public: vi.fn(), db: vi.fn() }));
vi.mock("@/server/onboarding/status", () => ({ onboardingStatus: m.status }));
vi.mock("@/server/platform/ai-usage", () => ({ modoIaDe: m.mode }));
vi.mock("@/server/ai/credentials", () => ({ getAiCredentialPublic: m.public }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
import { mensajeDeEstado, type EstadoIa } from "@/lib/ai/provider";
import { guideStatus } from "@/server/onboarding/guide";

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PLATAFORMA", "off");
  m.status.mockResolvedValue({ enabled: false, steps: ["profile", "whatsapp", "brain", "ai"].map((key) => ({ key, status: key === "ai" ? "pending" : "ready", problem: null })) });
});
afterEach(() => vi.unstubAllEnvs());
const estados: EstadoIa[] = [{ activa: false, motivo: "sin_configurar" },
  { activa: false, motivo: "token_invalido", last4: "1234", desde: null },
  { activa: false, motivo: "sin_saldo", last4: "1234", desde: null }];
const mensajes = ["Tu agente no puede contestar todavía: configura tu proveedor de IA en Ajustes → IA.",
  "Tu agente está pausado: el proveedor rechazó tu llave. Revísala en Ajustes → IA.",
  "Tu agente está pausado: tu cuenta del proveedor de IA se quedó sin saldo. Recárgala y pulsa «Probar conexión» en Ajustes → IA."];
describe("mensajes y guía gestionados", () => {
  it.each(estados.map((estado, i) => ({ estado, mensaje: mensajes[i] })))("apagada conserva mensaje exacto de $estado.motivo", ({ estado, mensaje }) => {
    expect(mensajeDeEstado(estado)).toBe(mensaje);
  });
  it.each(estados)("encendida deriva $motivo a la plataforma", (estado) => {
    vi.stubEnv("PLATAFORMA", "on");
    expect(mensajeDeEstado(estado)).toContain("la IA la administra la plataforma");
    expect(mensajeDeEstado(estado)).toContain("Contacta a quien la administra");
    expect(mensajeDeEstado(estado)).not.toContain("Ajustes");
  });
  it.each(["on", "off"])("IA activa no avisa con bandera %s", (flag) => {
    vi.stubEnv("PLATAFORMA", flag); expect(mensajeDeEstado({ activa: true, origen: "org", last4: "1234" })).toBeNull();
  });
  it("apagada conserva la guía sin consultas de plataforma", async () => {
    const guia = await guideStatus("org");
    expect(guia.steps.find((s) => s.key === "ai")).toMatchObject({ done: false, href: "/settings/ai", cta: "Vincular proveedor", hint: null });
    expect(m.mode).not.toHaveBeenCalled(); expect(m.public).not.toHaveBeenCalled();
  });
  it("platform cuenta como hecho aunque falte crédito o proveedor", async () => {
    vi.stubEnv("PLATAFORMA", "on"); m.mode.mockResolvedValue("platform");
    const guia = await guideStatus("org");
    expect(guia.steps.find((s) => s.key === "ai")).toMatchObject({ done: true, href: "/onboarding", hint: "La gestiona la plataforma" });
    expect(guia.complete).toBe(true); expect(m.public).not.toHaveBeenCalled();
  });
  it.each([null, { status: "active" }, { status: "paused_invalid_token" }])("own_key refleja existencia de llave %j sin enlace editable", async (cred) => {
    vi.stubEnv("PLATAFORMA", "on"); m.mode.mockResolvedValue("own_key"); m.public.mockResolvedValue(cred);
    const paso = (await guideStatus("org")).steps.find((s) => s.key === "ai");
    expect(paso).toMatchObject({ done: cred !== null, href: "/onboarding", hint: "La gestiona la plataforma" });
    expect(m.public).toHaveBeenCalledWith("org");
  });
});
