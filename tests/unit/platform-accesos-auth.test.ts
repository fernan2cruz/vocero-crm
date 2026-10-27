import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type Contexto = { path: string; body?: { email?: string }; headers?: Headers; context: { returned?: unknown } };
type Sesion = { userId: string; activeOrganizationId?: string | null; userAgent?: string };
const mocks = vi.hoisted(() => ({
  registrar: vi.fn(),
  hooks: undefined as undefined | { before: (ctx: Contexto) => Promise<unknown>; after: (ctx: Contexto) => Promise<unknown> },
  despuesSesion: undefined as undefined | ((session: Sesion, ctx?: Contexto) => Promise<void>),
}));
vi.mock("better-auth", () => ({ betterAuth: (opciones: {
  hooks: NonNullable<typeof mocks.hooks>;
  databaseHooks: { session: { create: { after: NonNullable<typeof mocks.despuesSesion> } } };
}) => {
  mocks.hooks = opciones.hooks; mocks.despuesSesion = opciones.databaseHooks.session.create.after;
  return {};
} }));
// El middleware real envuelve el contexto del framework; aquí se ejercitan los callbacks configurados.
vi.mock("better-auth/api", async (original) => ({ ...await original<typeof import("better-auth/api")>(), createAuthMiddleware: (fn: unknown) => fn }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_BASE_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "ficticio-para-pruebas" }) }));
vi.mock("@/server/platform/accesos", async (original) => ({ ...await original<typeof import("@/server/platform/accesos")>(), registrarAcceso: mocks.registrar }));
import { getAuth } from "@/lib/auth";
import { resetRateLimit } from "@/lib/rate-limit";

const contexto = (): Contexto => ({ path: "/sign-in/email", body: { email: "  Intento@ejemplo.com " },
  headers: new Headers({ "x-forwarded-for": "198.51.100.1, proxy", "user-agent": "Navegador" }), context: {} });
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); resetRateLimit(); mocks.registrar.mockReset().mockResolvedValue(undefined); getAuth();
});
afterEach(() => vi.unstubAllEnvs());

describe("enganches de Better Auth", () => {
  it("apagada no registra ni cambia el resultado de los callbacks", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    const ctx = contexto(); ctx.context.returned = new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" });
    await mocks.hooks!.before(ctx); await mocks.hooks!.after(ctx);
    await mocks.despuesSesion!({ userId: "u" }, ctx);
    expect(mocks.registrar).not.toHaveBeenCalled();
  });
  it("error reconocido registra una vez; desconocido, éxito y otra ruta no registran fallos", async () => {
    const ctx = contexto(); ctx.context.returned = new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" });
    await mocks.hooks!.after(ctx);
    expect(mocks.registrar).toHaveBeenCalledWith({ kind: "failure", reason: "bad_credentials", email: ctx.body?.email,
      ip: "198.51.100.1", userAgent: "Navegador" });
    ctx.context.returned = new APIError("INTERNAL_SERVER_ERROR", { message: "fallo" }); await mocks.hooks!.after(ctx);
    ctx.context.returned = { user: { id: "u" } }; await mocks.hooks!.after(ctx);
    ctx.path = "/sign-up/email"; await mocks.hooks!.after(ctx);
    expect(mocks.registrar).toHaveBeenCalledTimes(1);
  });
  it("registra 429 en before porque Better Auth omite after cuando rechaza allí", async () => {
    const ctx = contexto();
    for (let i = 0; i < 10; i++) await mocks.hooks!.before(ctx);
    await expect(mocks.hooks!.before(ctx)).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.registrar).toHaveBeenCalledTimes(1);
    expect(mocks.registrar).toHaveBeenCalledWith(expect.objectContaining({ kind: "failure", reason: "rate_limited" }));
  });
  it("éxito usa solo metadatos y no espera una escritura pendiente", async () => {
    mocks.registrar.mockReturnValue(new Promise(() => {}));
    await mocks.despuesSesion!({ userId: "u", activeOrganizationId: "o" }, contexto());
    expect(mocks.registrar).toHaveBeenCalledWith({ kind: "success", userId: "u", organizationId: "o",
      ip: "198.51.100.1", userAgent: "Navegador" });
  });
});
