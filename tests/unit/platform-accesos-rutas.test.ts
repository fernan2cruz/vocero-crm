import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sesion: vi.fn(), admin: vi.fn(), eventos: vi.fn(), alertas: vi.fn(), sesiones: vi.fn(),
  buscar: vi.fn(), csv: vi.fn(), cerrar: vi.fn(), cerrarUsuario: vi.fn(), cerrarNegocio: vi.fn(), rol: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.sesion } }) }));
vi.mock("@/server/platform/admins", () => ({ esSuperadmin: mocks.admin }));
vi.mock("@/server/platform/accesos", () => ({ eventosDeAcceso: mocks.eventos, alertasDeAcceso: mocks.alertas }));
vi.mock("@/server/platform/auditoria", () => ({ buscarAuditoria: mocks.buscar, exportarAuditoriaCsv: mocks.csv }));
vi.mock("@/server/platform/sesiones", () => ({ listarSesiones: mocks.sesiones,
  cerrarSesion: mocks.cerrar, cerrarSesionesDeUsuario: mocks.cerrarUsuario, cerrarSesionesDeNegocio: mocks.cerrarNegocio }));
vi.mock("@/server/platform/roles", () => ({ cambiarRol: mocks.rol }));
import { GET as audit } from "@/app/api/platform/audit/route";
import { GET as csv } from "@/app/api/platform/audit/export/route";
import { GET as eventos } from "@/app/api/platform/access/events/route";
import { GET as alertas } from "@/app/api/platform/access/alerts/route";
import { GET as sesiones } from "@/app/api/platform/sessions/route";
import { POST as accion } from "@/app/api/platform/sessions/action/route";
import { POST as rol } from "@/app/api/platform/users/[id]/role/route";

const contexto = { params: Promise.resolve({ id: "u" }) };
const peticion = (query = "") => new Request(`http://localhost/api/platform/prueba${query}`);
const post = (body: unknown) => new Request("http://localhost/api/platform/prueba", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); vi.resetAllMocks();
  mocks.sesion.mockResolvedValue({ user: { id: "actor", email: "actor@example.com" } });
  mocks.admin.mockResolvedValue(true); mocks.eventos.mockResolvedValue([]); mocks.alertas.mockResolvedValue({ porIp: [], porCorreo: [] });
  mocks.sesiones.mockResolvedValue([]); mocks.buscar.mockResolvedValue([]); mocks.csv.mockResolvedValue("csv");
  mocks.cerrar.mockResolvedValue(1); mocks.cerrarUsuario.mockResolvedValue(2); mocks.cerrarNegocio.mockResolvedValue(3);
  mocks.rol.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("rutas de accesos y registros", () => {
  it("todas pasan por la guardia y mantienen no-store incluso apagadas", async () => {
    vi.stubEnv("PLATAFORMA", "off");
    const respuestas = await Promise.all([
      audit(peticion()), csv(peticion()), eventos(peticion()), alertas(peticion()), sesiones(peticion()),
      accion(post({ action: "revoke", sessionId: "s" })), rol(post({ role: "admin" }), contexto),
    ]);
    for (const r of respuestas) {
      expect(r.status).toBe(404); expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(mocks.sesion).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
    for (const m of [mocks.eventos, mocks.alertas, mocks.sesiones, mocks.buscar, mocks.csv, mocks.cerrar, mocks.rol]) expect(m).not.toHaveBeenCalled();
  });
  it("sin sesión responde 401; no superadmin recibe 404", async () => {
    mocks.sesion.mockResolvedValue(null);
    expect((await sesiones(peticion())).status).toBe(401);
    mocks.sesion.mockResolvedValue({ user: { id: "actor", email: "actor@example.com" } }); mocks.admin.mockResolvedValue(false);
    expect((await sesiones(peticion())).status).toBe(404);
    expect(mocks.sesiones).not.toHaveBeenCalled();
  });
  it("periodos inválidos devuelven 422 y no consultan", async () => {
    for (const handler of [audit, csv, eventos]) {
      for (const query of ["?from=2026-02-30", "?from=2026-10-27&to=2026-10-01", "?days=367", "?limit=201"]) {
        const r = await handler(peticion(query));
        expect(r.status).toBe(422); expect(r.headers.get("Cache-Control")).toBe("no-store");
      }
    }
    expect(mocks.buscar).not.toHaveBeenCalled(); expect(mocks.csv).not.toHaveBeenCalled(); expect(mocks.eventos).not.toHaveBeenCalled();
  });
  it("valida consultas y cuerpos, y transmite la identidad del actor", async () => {
    expect((await alertas(peticion("?ventanaHoras=0"))).status).toBe(422);
    expect((await sesiones(peticion("?token=secreto"))).status).toBe(422);
    expect((await accion(post({ action: "revoke" }))).status).toBe(422);
    expect((await rol(post({ role: "superadmin" }), contexto)).status).toBe(422);
    expect(await (await accion(post({ action: "revoke", sessionId: "s" }))).json()).toEqual({ n: 1 });
    expect(await (await accion(post({ action: "revoke_user", userId: "u" }))).json()).toEqual({ n: 2 });
    expect(await (await accion(post({ action: "revoke_org", organizationId: "o" }))).json()).toEqual({ n: 3 });
    expect(mocks.cerrarNegocio).toHaveBeenCalledWith("o", { userId: "actor", email: "actor@example.com" });
    mocks.rol.mockResolvedValue({ ok: false, code: "last_owner" });
    const respuesta = await rol(post({ role: "member" }), contexto);
    expect(respuesta.status).toBe(409); expect(await respuesta.json()).toMatchObject({ error: { code: "last_owner" } });
    expect(mocks.rol).toHaveBeenCalledWith({ userId: "u", role: "member", actorUserId: "actor" });
  });
  it("devuelve cursor y CSV con tipo y descarga", async () => {
    mocks.buscar.mockResolvedValue([{ id: "aud_1", createdAt: new Date("2026-10-27T00:00:00Z") }]);
    expect(await (await audit(peticion())).json()).toMatchObject({ antes: "2026-10-27T00:00:00.000Z|aud_1" });
    const respuesta = await csv(peticion());
    expect(respuesta.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(respuesta.headers.get("Content-Disposition")).toContain('filename="auditoria.csv"');
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
  });
});
