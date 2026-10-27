import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), schema: {} }));
import { decidirDesactivacion } from "@/server/platform/users";

it.each([
  [true, "actor", "otro", { ok: false, code: "is_superadmin" }],
  [true, "actor", "actor", { ok: false, code: "is_superadmin" }],
  [false, "actor", "actor", { ok: false, code: "self" }],
  [false, "actor", "otro", { ok: true }],
])("decide la desactivación (%s, %s, %s)", (targetEsSuperadmin, actorId, targetId, esperado) => {
  expect(decidirDesactivacion({ targetEsSuperadmin, actorId, targetId })).toEqual(esperado);
});
