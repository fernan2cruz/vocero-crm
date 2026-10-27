import { afterEach, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({ organizaciones: 0, consultas: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => { estado.consultas(); return { select: () => ({ from: async () => [{ n: estado.organizaciones }] }) }; },
  schema: { organization: {} },
}));
import { isPublicSignupAllowed } from "@/server/auth/registration";
afterEach(() => { vi.unstubAllEnvs(); estado.consultas.mockClear(); });

it.each([0, 1])("apagada conserva el primer arranque con %s organizaciones", async (n) => {
  estado.organizaciones = n;
  vi.stubEnv("PLATAFORMA", "off");
  vi.stubEnv("ALLOW_SIGNUP", "");
  expect(await isPublicSignupAllowed()).toBe(n === 0);
  expect(estado.consultas).toHaveBeenCalledTimes(1);
  vi.stubEnv("ALLOW_SIGNUP", "true");
  expect(await isPublicSignupAllowed()).toBe(true);
  expect(estado.consultas).toHaveBeenCalledTimes(1);
});
it.each(["", "false", "1", "TRUE", "true"])("encendida solo acepta ALLOW_SIGNUP=%s sin consultar BD", async (valor) => {
  vi.stubEnv("PLATAFORMA", "on");
  vi.stubEnv("ALLOW_SIGNUP", valor);
  for (const n of [0, 1]) {
    estado.organizaciones = n;
    expect(await isPublicSignupAllowed()).toBe(valor === "true");
  }
  expect(estado.consultas).not.toHaveBeenCalled();
});
