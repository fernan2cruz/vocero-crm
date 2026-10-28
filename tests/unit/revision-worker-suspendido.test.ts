import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ estado: vi.fn(), tomar: vi.fn(), descartar: vi.fn(), entregar: vi.fn(), construir: vi.fn(), select: vi.fn() }));
vi.mock("@/server/platform/estado", () => ({ estadoDeNegocio: m.estado }));
vi.mock("@/server/brains/config", () => ({ leerConfigDespacho: () => ({ active: true }) }));
vi.mock("@/server/brains/deliver", () => ({ construirEvento: m.construir, entregar: m.entregar,
  rafagaDe: async () => [], sinDespachar: () => [] }));
vi.mock("@/server/dispatch/outbox", () => ({ tomarPendientes: m.tomar, descartarDespacho: m.descartar,
  renovarLease: async () => true, marcarEntregado: async () => true, mensajesAnotados: async () => [] }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: () => ({ select: m.select }) }));
import { tanda } from "@/server/dispatch/worker";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("suspensión durante el agrupado omite el despacho al entregar sin llamar al cerebro", async () => {
  vi.stubEnv("PLATAFORMA", "on");
  const fila = { id: "d", conversationId: "cv", organizationId: "org" };
  m.tomar.mockResolvedValueOnce([fila]).mockResolvedValue([]);
  m.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ aiEnabled: true }] }) }) });
  m.construir.mockResolvedValue({ messages: [{ id: "m" }] }); m.estado.mockResolvedValue("suspended");
  expect(await tanda()).toBe(1);
  expect(m.descartar).toHaveBeenCalledWith(fila, "negocio_suspendido");
  expect(m.entregar).not.toHaveBeenCalled();
});
it("apagada entrega con las consultas originales y ninguna consulta del negocio", async () => {
  vi.stubEnv("PLATAFORMA", "off");
  m.tomar.mockResolvedValueOnce([{ id: "d", conversationId: "cv", organizationId: "org" }]).mockResolvedValue([]);
  m.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ aiEnabled: true }] }) }) });
  m.construir.mockResolvedValue({ messages: [{ id: "m" }] }); m.entregar.mockResolvedValue({ ok: true });
  expect(await tanda()).toBe(1);
  expect(m.entregar).toHaveBeenCalledTimes(1); expect(m.select).toHaveBeenCalledTimes(1);
  expect(m.estado).not.toHaveBeenCalled(); expect(m.descartar).not.toHaveBeenCalled();
});
