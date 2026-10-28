import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sesion: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.sesion, UnauthorizedError: class extends Error {} }));
import { GET } from "@/app/api/events/route";
import { publish } from "@/server/events/bus";

const contexto = { userId: "u", organizationId: "org_sse", role: "member" };
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("PLATAFORMA", "on"); mocks.sesion.mockReset().mockResolvedValue(contexto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("SSE revocado", () => {
  it.each(["sesión cerrada", "usuario desactivado", "negocio suspendido"])("cierra el lector ante %s y no entrega eventos posteriores", async (motivo) => {
    const req = new Request("http://localhost/api/events", { headers: { cookie: "sesion=ficticia" } });
    const respuesta = await GET(req);
    const lector = respuesta.body!.getReader();
    expect(new TextDecoder().decode((await lector.read()).value)).toContain("conectado");
    mocks.sesion.mockRejectedValue(new Error(motivo));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.sesion).toHaveBeenLastCalledWith(req.headers);
    publish("org_sse", { type: "message.new", data: { conversationId: "cv", message: { id: "msg" } } });
    // Puede quedar el heartbeat anterior al cierre, nunca el mensaje nuevo.
    let lectura = await lector.read();
    while (!lectura.done) {
      expect(new TextDecoder().decode(lectura.value)).not.toContain("message.new");
      lectura = await lector.read();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it("apagada conserva la única comprobación inicial y el stream abierto", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    const respuesta = await GET(new Request("http://localhost/api/events"));
    const lector = respuesta.body!.getReader(); await lector.read();
    mocks.sesion.mockRejectedValue(new Error("revocada"));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.sesion).toHaveBeenCalledTimes(1);
    await lector.cancel(); expect(vi.getTimerCount()).toBe(0);
  });
  it("cierra si cambia el usuario o el negocio y libera temporizadores al cancelar", async () => {
    const respuesta = await GET(new Request("http://localhost/api/events"));
    const lector = respuesta.body!.getReader(); await lector.read();
    mocks.sesion.mockResolvedValue({ ...contexto, organizationId: "otra" });
    await vi.advanceTimersByTimeAsync(30_000);
    await lector.read(); expect((await lector.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
