import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn(), save: vi.fn(), del: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: m.db }));
vi.mock("@/server/platform/tenants", () => ({ obtenerNegocio: async () => ({ id: "org" }) }));
vi.mock("@/server/ai/credentials", () => ({ saveAiCredential: m.save, deleteAiCredential: m.del, AiCredentialError: class extends Error {} }));
vi.mock("@/server/platform/audit", () => ({ auditar: m.audit }));
import { guardarLlaveNegocio, revocarLlaveNegocio } from "@/server/platform/gestionado";

beforeEach(() => vi.resetAllMocks());
it.each(["rotar", "revocar"])("%s: fallo de auditoría deshace el cambio usando la misma transacción", async (action) => {
  let credencial = "anterior";
  const tx = { credencial: "anterior" };
  m.db.mockReturnValue({ transaction: async (fn: (tx: object) => Promise<unknown>) => {
    const result = await fn(tx);
    credencial = tx.credencial;
    return result;
  } });
  m.save.mockImplementation(async (_input, transaction) => {
    expect(transaction).toBe(tx); tx.credencial = "nueva";
    return { provider: "deepseek", model: "deepseek-chat", tokenLast4: "ueva" };
  });
  m.del.mockImplementation(async (_org, transaction) => { expect(transaction).toBe(tx); tx.credencial = ""; });
  m.audit.mockImplementation(async (_entry, transaction) => { expect(transaction).toBe(tx); throw new Error("fallo de auditoría"); });
  const req = new Request("http://localhost", { method: "PUT", body: JSON.stringify({ provider: "deepseek", model: "deepseek-chat", token: "nueva-llave" }) });
  await expect(action === "rotar" ? guardarLlaveNegocio("org", "actor", req) : revocarLlaveNegocio("org", "actor")).rejects.toThrow();
  expect(m.audit).toHaveBeenCalledTimes(1); expect(credencial).toBe("anterior");
});
