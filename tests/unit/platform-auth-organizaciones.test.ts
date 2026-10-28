import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Solo se sustituye el almacenamiento; Better Auth, cookies, router, plugin y
// middleware son reales. No requiere Postgres ni una conexión de red.
const datos = vi.hoisted(() => ({ memoria: {
  user: [] as Record<string, unknown>[], session: [] as Record<string, unknown>[],
  account: [] as Record<string, unknown>[], verification: [], organization: [] as Record<string, unknown>[],
  member: [] as Record<string, unknown>[], invitation: [] as Record<string, unknown>[],
} }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(datos.memoria) };
});
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_BASE_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "secreto-ficticio-largo-para-pruebas" }) }));
vi.mock("@/server/auth/on-signup", () => ({ onUserCreated: vi.fn(), resolveActiveOrganizationId: async () => "org_1" }));
vi.mock("@/server/auth/registration", () => ({ isPublicSignupAllowed: async () => false }));
vi.mock("@/server/platform/estado", () => ({ usuarioDesactivado: async () => false, estadoDeNegocio: async () => "active" }));
vi.mock("@/server/platform/accesos", () => ({ registrarAcceso: vi.fn(), motivoDeErrorAcceso: () => null }));
import { getAuth, runInternalSignup } from "@/lib/auth";
import { resetRateLimit } from "@/lib/rate-limit";

const cookies: Record<string, string> = {};
const mutaciones = [
  ["create", { name: "Otra", slug: "otra" }], ["delete", { organizationId: "org_1" }],
  ["update", { organizationId: "org_1", data: { name: "Nuevo" } }],
  ["update-member-role", { memberId: "mem_member", role: "admin", organizationId: "org_1" }],
  ["remove-member", { memberIdOrEmail: "mem_member", organizationId: "org_1" }],
  ["invite-member", { email: "invitado@ejemplo.test", role: "member", organizationId: "org_1" }],
  ["accept-invitation", { invitationId: "inv_1" }], ["reject-invitation", { invitationId: "inv_1" }],
  ["cancel-invitation", { invitationId: "inv_1" }], ["leave", { organizationId: "org_1" }],
] as const;
function pedir(rol: string, ruta: string, body?: unknown) {
  return getAuth().handler(new Request(`http://localhost:3000/api/auth/organization/${ruta}`, {
    method: body ? "POST" : "GET", headers: { cookie: cookies[rol]!, origin: "http://localhost:3000", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
beforeAll(async () => {
  vi.stubEnv("PLATAFORMA", "on");
  datos.memoria.organization.push({ id: "org_1", name: "Negocio", slug: "negocio", createdAt: new Date() });
  for (const rol of ["owner", "member"]) {
    const resultado = await runInternalSignup(() => getAuth().api.signUpEmail({
      body: { name: rol, email: `${rol}@ejemplo.test`, password: "temporal-123456" }, returnHeaders: true,
    }));
    cookies[rol] = resultado.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect(cookies[rol]).toContain("session_token");
    datos.memoria.member.push({ id: `mem_${rol}`, organizationId: "org_1", userId: resultado.response.user.id, role: rol, createdAt: new Date() });
  }
});
beforeEach(() => { vi.stubEnv("PLATAFORMA", "on"); resetRateLimit(); });
afterEach(() => vi.unstubAllEnvs());

describe.each(["owner", "member"])("organizaciones nativas con cookie de %s", (rol) => {
  it.each(mutaciones)("bloquea %s con código claro antes de mutar", async (ruta, cuerpo) => {
    const antes = JSON.stringify(datos.memoria);
    const respuesta = await pedir(rol, ruta, cuerpo);
    expect(respuesta.status).toBe(403);
    expect(await respuesta.json()).toMatchObject({ code: "gestionado_por_plataforma" });
    expect(JSON.stringify(datos.memoria)).toBe(antes);
  });
  it.each(["list", "get-full-organization", "get-active-member", "get-active-member-role", "list-members"])("permite %s", async (ruta) => {
    expect((await pedir(rol, ruta)).status).toBe(200);
  });
  it.each(["list-invitations", "get-invitation?invitationId=inexistente", "list-user-invitations"])("conserva la autorización nativa de la lectura %s", async (ruta) => {
    const encendida = await pedir(rol, ruta);
    vi.stubEnv("PLATAFORMA", "off");
    const apagada = await pedir(rol, ruta);
    expect(encendida.status).toBe(apagada.status);
    expect(await encendida.json()).toEqual(await apagada.json());
  });
  it("permite seleccionar organización y comprobar permisos sin cambiar roles", async () => {
    expect((await pedir(rol, "set-active", { organizationId: "org_1" })).status).toBe(200);
    expect((await pedir(rol, "has-permission", { permissions: { organization: ["update"] } })).status).toBe(200);
    expect((await pedir(rol, "check-slug", { slug: "nuevo-slug" })).status).toBe(200);
  });
  it.each(mutaciones)("apagada deja que Better Auth resuelva %s", async (ruta, cuerpo) => {
    vi.stubEnv("PLATAFORMA", "off");
    // Petición deliberadamente inválida: prueba el paso al endpoint nativo
    // sin borrar las fixtures que necesitan los demás casos.
    const respuesta = await pedir(rol, ruta, { ...cuerpo, organizationId: "inexistente", invitationId: "inexistente", slug: "INVALID SLUG" });
    const resultado = await respuesta.json();
    expect(resultado.code).not.toBe("gestionado_por_plataforma");
  });
});
