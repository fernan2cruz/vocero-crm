import { afterEach, beforeEach, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({
  negocio: vi.fn(async (): Promise<"active" | "suspended"> => "suspended"),
  encolar: vi.fn(async () => ({ notBefore: new Date() })),
  consultas: vi.fn(),
  filas: [] as unknown[][],
}));
vi.mock("@/server/platform/estado", () => ({ estadoDeNegocio: estado.negocio }));
vi.mock("@/server/dispatch/outbox", () => ({ encolarDespacho: estado.encolar }));
vi.mock("@/server/dispatch/worker", () => ({ iniciarWorker: vi.fn(), programarTanda: vi.fn() }));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return { ...real, getDb: () => ({ select: () => {
    estado.consultas();
    return { from: () => ({ where: () => ({ limit: async () => estado.filas.shift() ?? [] }) }) };
  } }) };
});
import { despacharAlCerebro } from "@/server/dispatch/encolar";
beforeEach(() => {
  vi.clearAllMocks();
  estado.filas = [[{ aiEnabled: true, handoffAt: null, isTest: false }], [{ enabled: true }]];
});
afterEach(() => vi.unstubAllEnvs());
it("no encola un negocio suspendido", async () => {
  vi.stubEnv("PLATAFORMA", "on");
  await despacharAlCerebro("cv_1", "org_1", "msg_1");
  expect(estado.encolar).not.toHaveBeenCalled();
  expect(estado.consultas).not.toHaveBeenCalled();
});
it("apagada conserva el despacho y solo las dos consultas originales", async () => {
  vi.stubEnv("PLATAFORMA", "off");
  await despacharAlCerebro("cv_1", "org_1", "msg_1");
  expect(estado.negocio).not.toHaveBeenCalled();
  expect(estado.consultas).toHaveBeenCalledTimes(2);
  expect(estado.encolar).toHaveBeenCalledWith({ organizationId: "org_1", conversationId: "cv_1", messageIds: ["msg_1"] });
});
