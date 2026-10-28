import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secret: undefined as string | undefined, recibir: vi.fn(), superadmin: vi.fn(), env: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.env }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => ({ userId: "miembro", organizationId: "A", role: "member" }), UnauthorizedError: class extends Error {} }));
vi.mock("@/server/platform/admins", () => ({ esSuperadmin: mocks.superadmin }));
vi.mock("@/server/webhooks/recibir", () => ({ recibirEvento: mocks.recibir }));
vi.mock("@/server/zernio/dispatch", () => ({ isAuthenticZernioDelivery: async () => true }));
import { POST as wa } from "@/app/api/webhooks/wa/[webhookToken]/route";
import { POST as ig } from "@/app/api/webhooks/ig/[webhookToken]/route";
import { POST as messenger } from "@/app/api/webhooks/messenger/[webhookToken]/route";
import { GET as ajustes } from "@/app/api/settings/webhook/route";

beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); vi.stubEnv("CHANNELS", "whatsapp,instagram,messenger");
  mocks.secret = undefined; mocks.recibir.mockReset().mockImplementation(async () => Response.json({ received: true }));
  mocks.superadmin.mockReset().mockResolvedValue(false);
  mocks.env.mockReset().mockImplementation(() => ({ META_WEBHOOK_VERIFY_TOKEN: "global-secreto", META_APP_SECRET: mocks.secret, APP_BASE_URL: "https://crm.test", CHANNELS: "whatsapp,instagram,messenger" }));
});
afterEach(() => vi.unstubAllEnvs());
const params = () => ({ params: Promise.resolve({ webhookToken: "global-secreto" }) });

describe.each([["wa", wa, "whatsapp_business_account"], ["ig", ig, "instagram"], ["messenger", messenger, "page"]] as const)("firma de Meta %s", (_nombre, handler, object) => {
  const cuerpo = JSON.stringify({ object, entry: [] });
  const peticion = (firma?: string) => new Request("http://localhost/api/webhooks/prueba", { method: "POST", body: cuerpo, headers: firma ? { "x-hub-signature-256": firma } : {} });
  it("sin secreto responde 503 sin guardar ni procesar", async () => {
    expect((await handler(peticion(), params())).status).toBe(503); expect(mocks.recibir).not.toHaveBeenCalled();
  });
  it("con secreto exige firma y acepta el cuerpo firmado", async () => {
    mocks.secret = "app-secret-de-prueba";
    expect((await handler(peticion(), params())).status).toBe(401);
    expect((await handler(peticion("sha256=incorrecta"), params())).status).toBe(401);
    const firma = "sha256=" + createHmac("sha256", mocks.secret).update(cuerpo).digest("hex");
    expect((await handler(peticion(firma), params())).status).toBe(200); expect(mocks.recibir).toHaveBeenCalledTimes(1);
  });
  it("apagada sigue aceptando Meta sin secreto", async () => {
    vi.stubEnv("PLATAFORMA", "off"); expect((await handler(peticion(), params())).status).toBe(200);
  });
});
it("Zernio conserva su verificación sin exigir App Secret de Meta", async () => {
  for (const handler of [ig, messenger]) expect((await handler(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ account: "cuenta" }) }), params())).status).toBe(200);
});
it("un miembro no recibe ningún secreto y apagada no consulta superadmin", async () => {
  expect(await (await ajustes()).json()).toEqual({ gestionado: true }); expect(mocks.env).not.toHaveBeenCalled();
  vi.stubEnv("PLATAFORMA", "off"); mocks.superadmin.mockClear();
  expect(await (await ajustes()).json()).toMatchObject({ verifyToken: "global-secreto", url: "https://crm.test/api/webhooks/wa/global-secreto" });
  expect(mocks.superadmin).not.toHaveBeenCalled();
});
