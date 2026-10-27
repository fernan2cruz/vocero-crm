import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  esSuperadmin: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/platform/admins", () => ({ esSuperadmin: mocks.esSuperadmin }));
import { withSuperadmin, requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";

describe("guardia de plataforma", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("PLATAFORMA", "on");
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getAuth.mockReturnValue({ api: { getSession: mocks.getSession } });
    mocks.getSession.mockResolvedValue({ user: { id: "u1", email: "admin@example.com" } });
    mocks.esSuperadmin.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("apagada devuelve 404 vacío sin tocar auth, BD ni handler", async () => {
    vi.stubEnv("PLATAFORMA", undefined);
    const handler = vi.fn();
    const response = await withSuperadmin(handler)();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.esSuperadmin).not.toHaveBeenCalled();
  });
  it("sin sesión devuelve 401", async () => {
    mocks.getSession.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await withSuperadmin(handler)();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "No autenticado" } });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.esSuperadmin).not.toHaveBeenCalled();
  });
  it("oculta la superficie a un usuario sin privilegios", async () => {
    mocks.esSuperadmin.mockResolvedValue(false);
    const handler = vi.fn();
    const response = await withSuperadmin(handler)();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(handler).not.toHaveBeenCalled();
  });
  it("entrega identidad y argumentos sin exigir organización", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    const response = await withSuperadmin(handler)("argumento");
    expect(await response.text()).toBe("ok");
    expect(handler).toHaveBeenCalledWith({ userId: "u1", email: "admin@example.com" }, "argumento");
    expect(mocks.esSuperadmin).toHaveBeenCalledWith("u1");
  });
  it.each(["auth", "base", "handler"])("captura un fallo inesperado de %s", async (origen) => {
    const error = new Error("fallo simulado");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn().mockResolvedValue(new Response());
    if (origen === "auth") mocks.getSession.mockRejectedValue(error);
    if (origen === "base") mocks.esSuperadmin.mockRejectedValue(error);
    if (origen === "handler") handler.mockRejectedValue(error);
    const response = await withSuperadmin(handler)();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal", message: "Error interno" } });
    expect(log).toHaveBeenCalled();
  });
  it("para páginas, apagada lanza sin consultar auth", async () => {
    vi.stubEnv("PLATAFORMA", undefined);
    await expect(requireSuperadmin()).rejects.toBeInstanceOf(PlataformaNoEncontrada);
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });
  it("para páginas, sin sesión o privilegios lanza la excepción de 404", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(requireSuperadmin()).rejects.toBeInstanceOf(PlataformaNoEncontrada);
    mocks.esSuperadmin.mockResolvedValue(false);
    await expect(requireSuperadmin()).rejects.toBeInstanceOf(PlataformaNoEncontrada);
  });
  it("para páginas devuelve la identidad del superadmin", async () => {
    await expect(requireSuperadmin()).resolves.toEqual({ userId: "u1", email: "admin@example.com" });
  });
});
