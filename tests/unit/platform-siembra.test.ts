import { afterEach, beforeEach, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({
  organizaciones: 0,
  getDb: vi.fn(),
  insertados: [] as { tabla: unknown; valor: unknown }[],
  bloqueo: vi.fn(),
}));
vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  const tx = {
    execute: estado.bloqueo,
    select: () => ({ from: async () => [{ n: estado.organizaciones }] }),
    insert: (tabla: unknown) => ({ values: async (valor: unknown) => { estado.insertados.push({ tabla, valor }); } }),
  };
  return { ...real, getDb: () => {
    estado.getDb();
    return { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
  } };
});
import { schema } from "@/lib/db";
import { onUserCreated } from "@/server/auth/on-signup";
beforeEach(() => {
  vi.clearAllMocks();
  estado.organizaciones = 0;
  estado.insertados.length = 0;
});
afterEach(() => vi.unstubAllEnvs());
it("plataforma encendida no crea organización ni consulta BD", async () => {
  vi.stubEnv("PLATAFORMA", "on");
  await onUserCreated("usr_1", "Ana");
  expect(estado.getDb).not.toHaveBeenCalled();
  expect(estado.insertados).toEqual([]);
});
it.each(["Ana", ""])("apagada preserva la siembra inicial para %s", async (nombre) => {
  vi.stubEnv("PLATAFORMA", "off");
  await onUserCreated("usr_1", nombre);
  expect(estado.bloqueo).toHaveBeenCalledOnce();
  expect(estado.insertados).toHaveLength(4);
  expect(estado.insertados[0]).toMatchObject({ tabla: schema.organization,
    valor: { name: nombre ? "Negocio de Ana" : "Mi negocio", slug: "principal" } });
  expect(estado.insertados[1]).toMatchObject({ tabla: schema.member, valor: { userId: "usr_1", role: "owner" } });
  expect(estado.insertados[2]?.valor).toMatchObject([
    { name: "Nuevo", position: 0, kind: "open" },
    { name: "En conversación", position: 1, kind: "open" },
    { name: "Interesado", position: 2, kind: "open" },
    { name: "Cliente", position: 3, kind: "won" },
    { name: "Perdido", position: 4, kind: "lost" },
  ]);
  expect(estado.insertados[3]?.tabla).toBe(schema.agentProfile);
});
it("apagada no siembra otra organización al crear una cuenta de equipo", async () => {
  vi.stubEnv("PLATAFORMA", "off");
  estado.organizaciones = 1;
  await onUserCreated("usr_2", "Otra");
  expect(estado.insertados).toEqual([]);
});
