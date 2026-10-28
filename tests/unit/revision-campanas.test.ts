import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const m = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn(), estado: vi.fn(), creds: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
vi.mock("@/server/inbox/ingest", () => ({ getOrCreateConversation: vi.fn() }));
vi.mock("@/server/contacts-list", () => ({ listContacts: vi.fn() }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: m.creds }));
vi.mock("@/server/whatsapp/templates", () => ({ sendTemplate: m.send }));
vi.mock("@/server/platform/estado", () => ({ estadoDeNegocio: m.estado }));
vi.mock("@/server/platform/limites", () => ({ verificarDestinatarios: vi.fn(), LimiteError: class extends Error {} }));
import { schema } from "@/lib/db";
import { enviarCampana } from "@/server/campaigns";

function base() {
  const campaign = { id: "cmp", status: "draft", templateId: "tpl", variables: [], createdAt: new Date() };
  const recipients = [1, 2].map((n) => ({ id: `r${n}`, contactId: `c${n}`, nombre: "Ana", status: "pending", detail: null as string | null }));
  const updates: { table: unknown; values: Record<string, unknown>; sql: string; params: unknown[] }[] = [];
  let claims = 0;
  let perderDestinatario = false;
  m.db.mockReturnValue({
    select: (fields?: Record<string, unknown>) => ({ from: (table: unknown) => {
      let filter = "";
      const rows = () => {
        if (table === schema.campaign) return fields?.c ? [{ c: { ...campaign }, tpl: { id: "tpl", name: "Hola", body: "Hola" } }] : [{ status: campaign.status }];
        if (table === schema.conversation) return [{ id: "cv" }];
        if (fields?.n) return [{ campaignId: "cmp", status: "pending", n: 2 }];
        if (fields?.estado) return [];
        if (fields?.nombre && !fields?.id) return [{ nombre: "Ana" }];
        return recipients.filter((r) => !filter.includes('"status"') || r.status === "pending");
      };
      const q = { innerJoin: () => q, where: (s: SQL) => { filter = new PgDialect().sqlToQuery(s).sql; return q; },
        orderBy: () => q, limit: async () => rows(), groupBy: async () => rows() };
      return q;
    } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (s: SQL) => {
      const query = new PgDialect().sqlToQuery(s);
      let applied = false;
      const apply = () => {
        if (applied) return [];
        applied = true;
        updates.push({ table, values, ...query });
        if (table === schema.campaign) {
          if (values.status === "sending") {
            expect(query.params).toContain("draft");
            if (campaign.status !== "draft") return [];
            claims++;
          }
          Object.assign(campaign, values);
          return [{ id: "cmp" }];
        }
        const r = recipients.find((r) => query.params.includes(r.id));
        if (!r) return [];
        if (values.status === "sending") {
          expect(query.params).toContain("pending");
          if (perderDestinatario) {
            perderDestinatario = false;
            r.status = "sent";
            return [];
          }
          if (r.status !== "pending") return [];
        }
        Object.assign(r, values);
        return [{ id: r.id }];
      };
      return { returning: async () => apply(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(apply()).then(resolve) };
    } }) }),
  });
  return { campaign, recipients, updates, claims: () => claims,
    perderDestinatario: () => { perderDestinatario = true; } };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PLATAFORMA", "off");
  m.estado.mockResolvedValue("active"); m.creds.mockResolvedValue({ status: "active" }); m.send.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
const input = { organizationId: "org", id: "cmp", confirmCount: 2 };

it("dos solicitudes sincronizadas antes del UPDATE reclaman una sola campaña y envían una vez por destinatario", async () => {
  const b = base();
  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  let arrivals = 0;
  m.creds.mockImplementation(async () => { if (++arrivals === 2) release(); await barrier; return { status: "active" }; });
  expect(await Promise.all([enviarCampana(input), enviarCampana(input)])).toEqual([{ ok: true }, { ok: true }]);
  await vi.waitFor(() => expect(b.campaign.status).toBe("done"));
  expect(b.claims()).toBe(1); expect(m.send).toHaveBeenCalledTimes(2);
  expect(b.recipients.map((r) => r.status)).toEqual(["sent", "sent"]);
  expect(m.estado).not.toHaveBeenCalled();
});

it("una campaña ya reclamada por otra réplica no ejecuta el envío", async () => {
  const b = base(); b.campaign.status = "sending";
  await enviarCampana(input);
  expect(m.send).not.toHaveBeenCalled(); expect(b.claims()).toBe(0);
});

it("perder el reclamo de un destinatario impide enviarlo o sobrescribir el resultado del ganador", async () => {
  const b = base(); b.perderDestinatario();
  await enviarCampana(input);
  await vi.waitFor(() => expect(b.campaign.status).toBe("done"));
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(b.updates.filter((u) => u.table === schema.campaignRecipient && u.params.includes("r1"))).toHaveLength(1);
});

it("un error al reclamar libera la reserva local y permite volver a intentar", async () => {
  base();
  const db = m.db();
  m.db.mockReturnValueOnce(db);
  const original = db.update;
  db.update = () => { throw new Error("fallo antes del reclamo"); };
  await expect(enviarCampana(input)).rejects.toThrow("fallo antes del reclamo");
  db.update = original;
  const b = base();
  await enviarCampana(input);
  await vi.waitFor(() => expect(b.campaign.status).toBe("done"));
  expect(m.send).toHaveBeenCalledTimes(2);
});

it("un rechazo previo al envío devuelve el destinatario a pending para reanudar", async () => {
  const b = base();
  m.send.mockRejectedValueOnce(Object.assign(new Error("límite"), { code: "limite_diario" }));
  await enviarCampana(input);
  await vi.waitFor(() => expect(b.updates.some((u) => u.table === schema.campaign && u.values.status === "draft")).toBe(true));
  expect(b.recipients.map((r) => r.status)).toEqual(["pending", "pending"]);
  expect(m.send).toHaveBeenCalledTimes(1);
});

it("suspender después del primer envío pausa en borrador y conserva pendientes con motivo", async () => {
  const b = base(); vi.stubEnv("PLATAFORMA", "on");
  m.send.mockImplementation(async () => { m.estado.mockResolvedValue("suspended"); });
  await enviarCampana(input);
  await vi.waitFor(() => expect(b.recipients[1]?.detail).toBe("negocio_suspendido"));
  await vi.waitFor(() => expect(b.campaign.status).toBe("draft"));
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(b.recipients.map((r) => r.status)).toEqual(["sent", "pending"]);
});
