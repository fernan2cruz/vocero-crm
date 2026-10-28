import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { verifyPassword } from "better-auth/crypto";
import { getTableName } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), superadmin: vi.fn(), audit: vi.fn(), duplicado: false,
  faltaNegocio: false, colision: false, fallo: "", filas: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: mocks.db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => ({ user: { id: "superadmin", email: "plataforma@ejemplo.test" } }) } }) }));
vi.mock("@/server/platform/admins", () => ({ esSuperadmin: mocks.superadmin }));
vi.mock("@/server/platform/audit", () => ({ auditar: mocks.audit }));
import { POST } from "@/app/api/platform/users/route";
import { crearUsuario } from "@/server/platform/users";

const cuerpo = { organizationId: "org_existente", name: "Asistente", email: "asistente@ejemplo.test", role: "member", tempPassword: "temporal-123456" };
const pedir = (datos: unknown = cuerpo) => POST(new Request("http://localhost/api/platform/users", { method: "POST", body: JSON.stringify(datos) }));
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); vi.stubEnv("ALLOW_SIGNUP", "false");
  mocks.superadmin.mockReset().mockResolvedValue(true); mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.duplicado = false; mocks.faltaNegocio = false; mocks.colision = false; mocks.fallo = "";
  mocks.filas = { user: [{ id: "propietario", email: "dueno@ejemplo.test", name: "Dueño", emailVerified: false, createdAt: new Date(), updatedAt: new Date() }], account: [], member: [{ id: "mem_owner", userId: "propietario", organizationId: "org_existente", role: "owner" }] };
  // Almacén transaccional de prueba: conserva las tablas juntas o revierte todo.
  const tx = {
    select: () => {
      let tabla = "";
      const consulta = { from: (t: Parameters<typeof getTableName>[0]) => { tabla = getTableName(t); return consulta; }, where: () => consulta,
        for: async () => mocks.faltaNegocio ? [] : [{ id: "org_existente" }],
        limit: async () => tabla === "user" && mocks.duplicado ? [{ id: "propietario" }] : [],
      }; return consulta;
    },
    insert: (t: Parameters<typeof getTableName>[0]) => ({ values: (fila: Record<string, unknown>) => {
      const tabla = getTableName(t);
      if (mocks.fallo === tabla) throw new Error("Fallo de escritura");
      if (!(mocks.colision && tabla === "user")) (mocks.filas[tabla] ??= []).push({ createdAt: new Date(), updatedAt: new Date(), emailVerified: false, ...fila });
      const resultado = { onConflictDoNothing: () => resultado, returning: async () => mocks.colision ? [] : [{ id: fila.id }] };
      return resultado;
    } }),
  };
  mocks.db.mockReset().mockReturnValue({ transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const antes = structuredClone(mocks.filas);
    try { return await fn(tx); } catch (e) { mocks.filas = antes; throw e; }
  } });
});
afterEach(() => vi.unstubAllEnvs());

describe("alta de personal desde plataforma", () => {
  it("agrega un segundo usuario y su credencial permite login real sin registro público", async () => {
    const respuesta = await pedir({ ...cuerpo, email: " Asistente@ejemplo.test " });
    expect(respuesta.status).toBe(201); expect(respuesta.headers.get("cache-control")).toBe("no-store");
    const resultado = await respuesta.json();
    expect(resultado.contrasenaTemporal).toBe(cuerpo.tempPassword);
    expect(mocks.filas.user).toHaveLength(2);
    expect(mocks.filas.member).toContainEqual(expect.objectContaining({ userId: resultado.usuario.id, organizationId: "org_existente", role: "member" }));
    const credencial = mocks.filas.account![0]!;
    expect(credencial.providerId).toBe("credential"); expect(credencial.password).not.toBe(cuerpo.tempPassword);
    expect(await verifyPassword({ hash: credencial.password as string, password: cuerpo.tempPassword })).toBe(true);
    const auth = betterAuth({ baseURL: "http://localhost:3000", secret: "secreto-ficticio-largo-para-pruebas",
      database: memoryAdapter({ ...mocks.filas, session: [], verification: [] }), emailAndPassword: { enabled: true, disableSignUp: true },
    });
    const login = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", { method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: cuerpo.email, password: cuerpo.tempPassword }),
    }));
    expect(login.status).toBe(200); expect(login.headers.getSetCookie().join(";")).toContain("session_token");
    expect(mocks.audit).toHaveBeenCalledWith({ actorUserId: "superadmin", action: "user.create", organizationId: "org_existente",
      targetUserId: resultado.usuario.id, detail: { name: cuerpo.name, email: cuerpo.email, role: "member" } }, expect.anything());
  });
  it.each(["admin", "member"])("admite %s y genera contraseña como la del propietario si se omite", async (role) => {
    const { tempPassword: _omitida, ...datos } = cuerpo;
    const respuesta = await pedir({ ...datos, role });
    expect(respuesta.status).toBe(201); expect((await respuesta.json()).contrasenaTemporal).toMatch(/^[A-Za-z2-9]{20}$/);
  });
  it.each(["preexistente", "carrera"])("correo duplicado %s devuelve 409 sin crear membresía ni auditoría", async (caso) => {
    mocks.duplicado = caso === "preexistente"; mocks.colision = caso === "carrera";
    expect((await pedir()).status).toBe(409); expect(mocks.filas.user).toHaveLength(1); expect(mocks.filas.member).toHaveLength(1); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["owner", "otro", ""])("rechaza rol %s antes de abrir transacción", async (role) => {
    expect((await pedir({ ...cuerpo, role })).status).toBe(422); expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(["corta", "x".repeat(129)])("misma política de contraseña temporal: rechaza longitud %s", async (tempPassword) => {
    expect((await pedir({ ...cuerpo, tempPassword })).status).toBe(422); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("un no-superadmin recibe 404 sin alta", async () => {
    mocks.superadmin.mockResolvedValue(false); expect((await pedir()).status).toBe(404); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("apagada responde 404 sin consultar siquiera superadmin", async () => {
    vi.stubEnv("PLATAFORMA", "off"); expect((await pedir()).status).toBe(404); expect(mocks.superadmin).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(["account", "member", "auditoria"])("revierte cuenta y membresía si falla %s", async (tabla) => {
    if (tabla === "auditoria") mocks.audit.mockRejectedValue(new Error("Auditoría no disponible")); else mocks.fallo = tabla;
    await expect(crearUsuario({ ...cuerpo, role: "member", actorUserId: "superadmin" })).rejects.toThrow();
    expect(mocks.filas.user).toHaveLength(1); expect(mocks.filas.member).toHaveLength(1); expect(mocks.filas.account).toHaveLength(0);
  });
  it("no crea cuentas para un negocio inexistente", async () => {
    mocks.faltaNegocio = true; expect((await pedir()).status).toBe(404); expect(mocks.filas.user).toHaveLength(1);
  });
});
