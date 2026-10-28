import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  desactivado: vi.fn(async () => false),
  negocio: vi.fn(async (): Promise<"active" | "suspended"> => "active"),
  membresia: vi.fn(async (): Promise<{ organizationId: string; role: string } | null> => ({ organizationId: "org_1", role: "owner" })),
  beforeSesion: undefined as undefined | ((session: { userId: string }) => Promise<unknown>),
  getSession: vi.fn(async () => ({ user: { id: "usr_1" } })),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("better-auth", () => ({ betterAuth: (opciones: {
  databaseHooks: { session: { create: { before: NonNullable<typeof estado.beforeSesion> } } };
}) => {
  estado.beforeSesion = opciones.databaseHooks.session.create.before;
  return { api: { getSession: estado.getSession } };
} }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_BASE_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "ficticio-para-pruebas" }) }));
vi.mock("@/server/auth/on-signup", () => ({
  onUserCreated: vi.fn(), resolveMembership: estado.membresia,
  resolveActiveOrganizationId: async () => (await estado.membresia())?.organizationId ?? null,
}));
vi.mock("@/server/platform/estado", () => ({ usuarioDesactivado: estado.desactivado, estadoDeNegocio: estado.negocio }));

import { getAuth } from "@/lib/auth";
import { requireSession } from "@/lib/auth/session";

beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on");
  estado.desactivado.mockClear().mockResolvedValue(false);
  estado.negocio.mockClear().mockResolvedValue("active");
  estado.membresia.mockClear().mockResolvedValue({ organizationId: "org_1", role: "owner" });
  getAuth();
});
afterEach(() => vi.unstubAllEnvs());

describe("S-7: sesión y login", () => {
  it("la revalidación SSE consulta auth con los headers capturados y sin caché de cookie", async () => {
    const headers = new Headers({ cookie: "sesion=ficticia" });
    await requireSession(headers);
    expect(estado.getSession).toHaveBeenLastCalledWith({ headers, query: { disableCookieCache: true } });
    await requireSession();
    expect(estado.getSession).toHaveBeenLastCalledWith({ headers: new Headers() });
  });
  it("apagada omite todas las lecturas nuevas", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    estado.desactivado.mockResolvedValue(true);
    estado.negocio.mockResolvedValue("suspended");
    expect(await requireSession()).toEqual({ userId: "usr_1", organizationId: "org_1", role: "owner" });
    await expect(estado.beforeSesion!({ userId: "usr_1" })).resolves.toMatchObject({ data: { activeOrganizationId: "org_1" } });
    expect(estado.desactivado).not.toHaveBeenCalled();
    expect(estado.negocio).not.toHaveBeenCalled();
  });
  it("usuario desactivado no conserva sesión ni inicia otra", async () => {
    estado.desactivado.mockResolvedValue(true);
    await expect(requireSession()).rejects.toThrow("Cuenta desactivada");
    await expect(estado.beforeSesion!({ userId: "usr_1" })).rejects.toMatchObject({ status: "FORBIDDEN", body: { message: "Cuenta desactivada" } });
    expect(estado.negocio).not.toHaveBeenCalled();
  });
  it("negocio suspendido no conserva sesión ni inicia otra", async () => {
    estado.negocio.mockResolvedValue("suspended");
    await expect(requireSession()).rejects.toThrow("Negocio suspendido");
    await expect(estado.beforeSesion!({ userId: "usr_1" })).rejects.toMatchObject({ status: "FORBIDDEN", body: { message: "Negocio suspendido" } });
  });
  it("superadmin sin negocio puede iniciar sesión", async () => {
    estado.membresia.mockResolvedValue(null);
    await expect(estado.beforeSesion!({ userId: "usr_1" })).resolves.toMatchObject({ data: { activeOrganizationId: null } });
    expect(estado.negocio).not.toHaveBeenCalled();
  });
});
