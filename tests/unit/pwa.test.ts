import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 048 — Wassapi instalable en el celular: el manifest sale de la marca, los
 * iconos tienen los tamaños que piden Chrome y el iPhone, y el service worker
 * no guarda nada en el dispositivo.
 */

const { getBrandingContext } = vi.hoisted(() => ({ getBrandingContext: vi.fn() }));
vi.mock("@/server/branding", () => ({
  getBrandingContext,
  getRequestBrandingContext: getBrandingContext,
  getBranding: async () => (await getBrandingContext()).branding,
}));
vi.mock("@/server/whatsapp/media", () => ({ readMediaFile: vi.fn() }));

import { DEFAULT_BRANDING } from "@/lib/branding";
import {
  appIconHref,
  buildManifest,
  NAV_INK,
  parseAppIconParams,
  shortAppName,
} from "@/lib/pwa";
import { GET as icono } from "@/app/api/branding/app-icon/route";

const marca = { name: "Ferretería El Martillo", accent: "#0d5bff", favicon: null };
beforeEach(() => vi.stubEnv("PLATAFORMA", "off"));
afterEach(() => vi.unstubAllEnvs());

describe("el manifest", () => {
  it("sale de la marca, sin «Wassapi» cableado", () => {
    const m = buildManifest(marca, "CRM de WhatsApp de Ferretería El Martillo");
    expect(m.name).toBe("Ferretería El Martillo");
    expect(m.short_name).toBe("Ferretería");
    expect(JSON.stringify(m)).not.toMatch(/vocero/i);
    expect(m).toMatchObject({
      display: "standalone",
      start_url: "/inbox",
      scope: "/",
      id: "/",
      lang: "es",
      theme_color: NAV_INK,
      background_color: NAV_INK,
    });
  });

  it("trae los iconos que pide Chrome para instalar: 192 y 512, y un maskable", () => {
    const iconos = buildManifest(marca, "x").icons ?? [];
    expect(iconos.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
    for (const i of iconos) {
      expect(i.type).toBe("image/png");
      expect(i.src).toMatch(/^\/api\/branding\/app-icon\?size=(192|512)/);
      // El mismo sufijo de caché que el favicon: cambia con la marca.
      expect(i.src).toMatch(/&v=g[0-9a-z]+$/);
    }
  });

  it("el sufijo cambia si cambia el nombre o el acento", () => {
    expect(appIconHref(marca, 192)).not.toBe(appIconHref({ ...marca, name: "Otra" }, 192));
    expect(appIconHref(marca, 192)).not.toBe(appIconHref({ ...marca, accent: "#123456" }, 192));
  });
});

describe("el nombre corto bajo el icono", () => {
  it("cabe en 12 caracteres y prefiere la primera palabra entera", () => {
    expect(shortAppName("Wassapi")).toBe("Wassapi");
    expect(shortAppName("Taller Ruiz")).toBe("Taller Ruiz");
    expect(shortAppName("Ferretería El Martillo")).toBe("Ferretería");
    expect(shortAppName("Supercalifragilístico SA")).toBe("Supercalifra");
    expect(shortAppName("   ")).toBe("CRM");
  });
});

describe("los parámetros del icono", () => {
  it("solo 180, 192 y 512; purpose any o maskable", () => {
    const p = (q: string) => parseAppIconParams(new URLSearchParams(q));
    expect(p("size=192")).toEqual({ size: 192, purpose: "any" });
    expect(p("size=512&purpose=maskable")).toEqual({ size: 512, purpose: "maskable" });
    expect(p("size=180")).toEqual({ size: 180, purpose: "any" });
    expect(p("size=64")).toBeNull();
    expect(p("size=abc")).toBeNull();
    expect(p("")).toBeNull();
    expect(p("size=192&purpose=monochrome")).toBeNull();
  });

  it("la ruta responde 400 con un tamaño que no existe", async () => {
    const res = await icono(new Request("http://x/api/branding/app-icon?size=64"));
    expect(res.status).toBe(400);
  });
});

describe("la ruta del icono dibuja un PNG del tamaño pedido", () => {
  it("en plataforma el PNG de la sesión nunca se guarda en caché compartida", async () => {
    vi.stubEnv("PLATAFORMA", "on");
    getBrandingContext.mockResolvedValue({ organizationId: "org_1", branding: DEFAULT_BRANDING });
    const respuesta = await icono(new Request("http://localhost/api/branding/app-icon?size=192&v=g1"));
    expect(respuesta.headers.get("cache-control")).toBe("private, no-store");
    await respuesta.arrayBuffer();
  });
  /** Ancho y alto del IHDR de un PNG. */
  const dimensiones = (b: Uint8Array) => {
    const dv = new DataView(b.buffer, b.byteOffset);
    return [dv.getUint32(16), dv.getUint32(20)];
  };

  it.each([
    ["Wassapi", 192, "any"],
    ["Ferretería El Martillo", 512, "maskable"],
    ["Taller Ruiz", 180, "any"],
  ] as const)("%s · %i · %s", async (name, size, purpose) => {
    getBrandingContext.mockResolvedValue({
      organizationId: "org_1",
      branding: { ...DEFAULT_BRANDING, name },
    });
    const q = `size=${size}${purpose === "maskable" ? "&purpose=maskable" : ""}&v=g1`;
    const res = await icono(new Request(`http://x/api/branding/app-icon?${q}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(dimensiones(bytes)).toEqual([size, size]);
  }, 30_000);
});

describe("el service worker no guarda nada", () => {
  const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const codigo = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("no abre cachés ni guarda respuestas", () => {
    expect(codigo).not.toMatch(/caches\.|cache\.put|indexedDB|localStorage/);
  });

  it("solo atiende navegaciones: la API y el SSE van directo a la red", () => {
    expect(codigo).toMatch(/event\.request\.mode !== "navigate"\) return;/);
  });

  it("la página sin conexión no lleva el nombre de nadie (white-label)", () => {
    expect(codigo).toMatch(/Sin conexión/);
    expect(codigo).not.toMatch(/vocero/i);
  });
});
