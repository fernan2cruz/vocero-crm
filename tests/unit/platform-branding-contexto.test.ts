import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), order: vi.fn(), select: vi.fn(), org: "A" }));
vi.mock("@/lib/auth/session", () => ({ getSessionOrNull: mocks.session, requireSession: vi.fn(), UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.db }));
vi.mock("@/server/whatsapp/media", () => ({ readMediaFile: vi.fn() }));
vi.mock("@/server/apariencia", () => ({ aparienciaActual: async () => ({ apariencia: { tema: "menta", letra: "urbanist", tamano: "normal", densidad: "normal" } }) }));
vi.mock("next/font/google", () => {
  const fuente = () => ({ variable: "fuente" });
  return { Archivo: fuente, IBM_Plex_Mono: fuente, IBM_Plex_Sans: fuente, Instrument_Serif: fuente, Inter: fuente, Urbanist: fuente };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CHANNELS: "whatsapp" }) }));
import { DEFAULT_BRANDING } from "@/lib/branding";
import { generatedFaviconSvg } from "@/lib/favicon";
import { getBranding, getRequestBranding } from "@/server/branding";
import { generateMetadata } from "@/app/layout";
import AuthLayout from "@/app/(auth)/layout";
import manifest from "@/app/manifest";
import { GET as favicon } from "@/app/api/branding/favicon/route";

const marcas = { A: { ...DEFAULT_BRANDING, name: "Almacén A", accent: "#125577" }, B: { ...DEFAULT_BRANDING, name: "Botica B", accent: "#772255" } };
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); mocks.session.mockReset().mockResolvedValue(null);
  mocks.db.mockReset(); mocks.order.mockReset(); mocks.select.mockReset();
  mocks.db.mockImplementation(() => ({ select: mocks.select }));
  mocks.select.mockImplementation(() => {
    const consulta = { from: () => consulta, where: () => consulta,
      orderBy: (...args: unknown[]) => { mocks.order(...args); return consulta; },
      limit: async () => [{ id: mocks.org, metadata: JSON.stringify({ branding: marcas[mocks.org as "A" | "B"] }) }],
    }; return consulta;
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("marcas con dos negocios", () => {
  it("login, título, favicon y manifest públicos nunca toman la primera marca", async () => {
    for (const org of ["A", "B"]) {
      mocks.org = org;
      expect(await getBranding()).toEqual(DEFAULT_BRANDING);
      const login = renderToStaticMarkup(await AuthLayout({ children: createElement("p", null, "Entrar") }));
      expect(login).not.toContain(marcas.A.name); expect(login).not.toContain(marcas.B.name);
      expect((await generateMetadata()).title).toContain(DEFAULT_BRANDING.name);
      expect((await manifest()).name).toBe(DEFAULT_BRANDING.name);
      const icono = await favicon(new Request("http://localhost/api/branding/favicon?v=prueba"));
      expect(await icono.text()).toBe(generatedFaviconSvg(DEFAULT_BRANDING));
      expect(icono.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(["A", "B"] as const)("la sesión de %s resuelve su título, favicon y manifest", async (org) => {
    mocks.org = org; mocks.session.mockResolvedValue({ organizationId: org });
    expect(await getRequestBranding()).toEqual(marcas[org]);
    expect((await generateMetadata()).title).toContain(marcas[org].name);
    expect((await manifest()).name).toBe(marcas[org].name);
    expect(await (await favicon(new Request("http://localhost/api/branding/favicon"))).text()).toBe(generatedFaviconSvg(marcas[org]));
  });
  it("apagada conserva el negocio único con orden determinista y sin consultar sesión", async () => {
    vi.stubEnv("PLATAFORMA", "off"); mocks.org = "A";
    expect(await getRequestBranding()).toEqual(marcas.A);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.db).toHaveBeenCalledTimes(1); expect(mocks.order).toHaveBeenCalledTimes(1);
  });
});
