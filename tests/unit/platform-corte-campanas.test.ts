import { afterEach, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({ negocio: vi.fn(async () => "suspended"), consultas: vi.fn() }));
vi.mock("@/server/platform/estado", () => ({ estadoDeNegocio: estado.negocio }));
vi.mock("@/server/inbox/ingest", () => ({ getOrCreateConversation: vi.fn() }));
vi.mock("@/server/contacts-list", () => ({ listContacts: vi.fn() }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: vi.fn() }));
vi.mock("@/server/whatsapp/templates", () => ({ sendTemplate: vi.fn() }));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return { ...real, getDb: () => ({ select: () => {
    estado.consultas();
    return { from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) };
  } }) };
});
import { enviarCampana } from "@/server/campaigns";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("un negocio suspendido no inicia una campaña", async () => {
  vi.stubEnv("PLATAFORMA", "on");
  expect(await enviarCampana({ organizationId: "org_1", id: "cmp_1", confirmCount: 1 }))
    .toEqual({ ok: false, code: "bad_state", message: "El negocio está suspendido" });
  expect(estado.consultas).not.toHaveBeenCalled();
});
it("apagada conserva la consulta de campaña y no consulta el estado de plataforma", async () => {
  vi.stubEnv("PLATAFORMA", "off");
  expect(await enviarCampana({ organizationId: "org_1", id: "cmp_1", confirmCount: 1 }))
    .toMatchObject({ ok: false, code: "not_found" });
  expect(estado.negocio).not.toHaveBeenCalled();
  expect(estado.consultas).toHaveBeenCalledTimes(1);
});
