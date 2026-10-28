import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
vi.mock("@/server/branding", () => ({ getBranding: async () => ({ currency: "MXN" }) }));
vi.mock("@/server/contact-sales", () => ({ idsConVentas: async () => [], valorPorContacto: async () => new Map() }));
vi.mock("@/server/contact-tags", () => ({ tagsByContact: async () => new Map() }));
import { schema } from "@/lib/db";
import { listContacts } from "@/server/contacts-list";

it("archivados recientes que superan el límite no desplazan activos antiguos; archived=true los incluye", async () => {
  const contactos = [1, 2, 3].map((id) => ({ id: `archivado${id}`, archivedAt: new Date() }))
    .concat([{ id: "activo", archivedAt: null as unknown as Date }]);
  m.db.mockReturnValue({ select: () => ({ from: (table: unknown) => {
    let activos = false;
    const q = { innerJoin: () => q, where: (s: SQL) => {
      activos = new PgDialect().sqlToQuery(s).sql.includes('"archived_at" is null');
      return table === schema.lead ? Promise.resolve([]) : q;
    }, orderBy: () => q, limit: async (n: number) => contactos.filter((c) => !activos || !c.archivedAt).slice(0, n) };
    return q;
  } }) });
  expect((await listContacts("org", new URLSearchParams(), 2)).map((c) => c.row.id)).toEqual(["activo"]);
  expect((await listContacts("org", new URLSearchParams("archived=true"), 2)).map((c) => c.row.id)).toEqual(["archivado1", "archivado2"]);
});
