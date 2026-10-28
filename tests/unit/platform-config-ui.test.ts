import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { clavesConfig, registroConfig } from "@/server/platform/config/registry";
import { ConfiguracionClient, EditarConfig } from "@/components/platform/configuracion-client";
import type { listarConfig } from "@/server/platform/config/service";

const mocks = vi.hoisted(() => ({ guardia: vi.fn(), listar: vi.fn(), valor: vi.fn(), ia: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("404"); } }));
vi.mock("@/server/platform/guard", () => ({ requireSuperadmin: mocks.guardia, PlataformaNoEncontrada: class extends Error {} }));
vi.mock("@/server/platform/config/service", () => ({ listarConfig: mocks.listar, valorDeConfig: mocks.valor }));
vi.mock("@/server/platform/ai-usage", () => ({ ajustesIaPlataforma: mocks.ia }));
vi.mock("@/server/whatsapp/webhook-url", () => ({ webhookUrl: () => "https://crm.test/api/webhooks/wa/token-del-operador" }));
import Page from "@/app/(platform)/platform/configuracion/page";
import { PlataformaNoEncontrada } from "@/server/platform/guard";

const filas: Awaited<ReturnType<typeof listarConfig>> = clavesConfig.map((key) => {
  const def = registroConfig[key];
  return { key, etiqueta: def.etiqueta, grupo: def.grupo, tipo: def.tipo, ayuda: def.ayuda,
    configurado: def.tipo !== "secreto", origen: "default", ultimos4: null, valor: def.tipo === "secreto" ? null : def.default };
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.guardia.mockResolvedValue({ userId: "admin" });
  mocks.listar.mockResolvedValue(filas); mocks.valor.mockResolvedValue("token-del-operador");
  mocks.ia.mockResolvedValue({ configurada: false });
});
it("la guardia de página precede a todos los datos, incluso el verify token", async () => {
  mocks.guardia.mockRejectedValue(new PlataformaNoEncontrada());
  await expect(Page()).rejects.toThrow("404");
  for (const fn of [mocks.listar, mocks.valor, mocks.ia]) expect(fn).not.toHaveBeenCalled();
});
it("presenta catálogo, pendientes y webhook solo después de exigir superadmin", async () => {
  const html = renderToStaticMarkup(await Page());
  for (const key of clavesConfig) expect(html).toContain(key);
  for (const texto of ["Pendiente de configurar", "WhatsApp y Meta", "Registro", "Módulos", "Avanzado", "Webhook de Meta", "token-del-operador", "Copiar", "/platform/ia"]) expect(html).toContain(texto);
  expect(mocks.guardia).toHaveBeenCalledTimes(1);
});
it("secretos muestran únicamente últimos cuatro en el catálogo y el editor empieza vacío", () => {
  const fila = { ...filas[0]!, configurado: true, origen: "portal", ultimos4: "1234", valor: null };
  const html = renderToStaticMarkup(createElement(ConfiguracionClient, { filas: [fila], iaConfigurada: true, webhook: { url: "url-operador", token: "token-operador" } }));
  expect(html).toContain("Configurado en el portal"); expect(html).toContain("termina en 1234"); expect(html).toContain("No hay pendientes.");
  const editor = renderToStaticMarkup(createElement(EditarConfig, { fila, onCerrar: () => {}, onGuardar: async () => {} }));
  expect(editor).toContain('type="password"'); expect(editor).toContain('autoComplete="new-password"');
  expect(editor).toContain('value=""'); expect(editor).not.toContain('value="1234"');
});
it("orígenes y campos booleanos/enteros/lista se presentan sin confundir false con ausencia", () => {
  const campos: Awaited<ReturnType<typeof listarConfig>> = [
    { ...filas[3]!, origen: "env" }, { ...filas[4]!, origen: "portal", valor: 7 },
    { ...filas[5]!, origen: "portal", valor: ["whatsapp", "instagram"] },
    { ...filas[1]!, origen: "autogenerado", configurado: true, ultimos4: "abcd" },
  ];
  const html = renderToStaticMarkup(createElement(ConfiguracionClient, { filas: campos, iaConfigurada: true, webhook: { url: "url", token: "token" } }));
  for (const texto of ["Viene del .env", "Configurado en el portal", "Autogenerado", "whatsapp, instagram", "No"]) expect(html).toContain(texto);
  const editor = renderToStaticMarkup(createElement(EditarConfig, { fila: campos[0]!, onCerrar: () => {}, onGuardar: async () => {} }));
  expect(editor).toContain("select"); expect(editor).toContain('value="false" selected=""');
});
