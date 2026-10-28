import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ db: vi.fn(), graph: vi.fn(), credenciales: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb: m.db }));
vi.mock("@/lib/meta/client", async (original) => ({ ...await original<typeof import("@/lib/meta/client")>(), graphRequest: m.graph }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: m.credenciales, markReconnectRequired: vi.fn() }));
import { schema } from "@/lib/db";
import { sendText, sendMediaMessage, sendStructured, SendError } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";

const input = { organizationId: "org_1", conversationId: "cv_1" };
let isTest: boolean;
const tablas: unknown[] = [];
const db = {
  select: () => ({ from: (tabla: unknown) => {
    tablas.push(tabla);
    const filas = tabla === schema.conversation ? [{ conversation: { ...input, id: "cv_1", isTest, channel: "whatsapp", lastInboundAt: new Date() }, contact: { id: "ct_1", phone: "525555555555" } }]
      : tabla === schema.template ? [{ id: "tpl_1", status: "approved", body: "Hola" }]
      : tabla === schema.organizationLimits ? [{ maxMessagesPerDay: 1, maxCampaignRecipients: null, maxMonthlySpendMicros: null }]
      : tabla === schema.calendarSettings ? [{ timezone: "America/Caracas" }] : [{ n: 1 }];
    const chain = { innerJoin: () => chain, where: () => chain,
      limit: async () => filas, then: (resolver: (r: unknown[]) => unknown) => Promise.resolve(filas).then(resolver) };
    return chain;
  } }),
};
beforeEach(() => {
  vi.stubEnv("PLATAFORMA", "on"); isTest = false; tablas.length = 0;
  m.db.mockReset().mockReturnValue(db); m.graph.mockReset(); m.credenciales.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("los cuatro caminos cortan antes de tocar Meta", () => {
  const caminos = [
    () => sendText({ ...input, text: "Hola" }),
    () => sendMediaMessage({ ...input, file: { mimeType: "image/png", data: Buffer.from("png") } }),
    () => sendStructured({ ...input, kind: "location", location: { latitude: 1, longitude: 1 } }),
    () => sendTemplate({ ...input, templateId: "tpl_1" }),
  ];
  it.each(caminos)("límite diario impide enviar sin consultar credenciales ni guardar fallidos", async (enviar) => {
    await expect(enviar()).rejects.toBeInstanceOf(SendError);
    await expect(enviar()).rejects.toMatchObject({ code: "limite_diario" });
    expect(m.graph).not.toHaveBeenCalled(); expect(m.credenciales).not.toHaveBeenCalled();
  });
  it.each(caminos)("el sandbox se rechaza antes de consultar límites", async (enviar) => {
    isTest = true;
    await expect(enviar()).rejects.toMatchObject({ code: "sandbox_violation" });
    expect(tablas).not.toContain(schema.organizationLimits);
    expect(m.graph).not.toHaveBeenCalled();
  });
});
