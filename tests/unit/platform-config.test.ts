import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  filas: new Map<string, Record<string, unknown>>(), lecturas: vi.fn(), escrituras: vi.fn(), auditoria: vi.fn(),
  error: false, pausa: undefined as undefined | Promise<void>,
}));
vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const db = {
    select: () => ({ from: async () => {
      estado.lecturas();
      if (estado.error) throw new Error("driver con secreto-no-imprimir");
      const filas = [...estado.filas.values()];
      await estado.pausa;
      return filas;
    } }),
    insert: () => ({ values: (fila: Record<string, unknown>) => {
      estado.escrituras(fila);
      const key = String(fila.key);
      return {
        onConflictDoNothing: async () => { if (!estado.filas.has(key)) estado.filas.set(key, fila); },
        onConflictDoUpdate: async () => {
          if (estado.error) throw new Error("driver con secreto-no-imprimir");
          estado.filas.set(key, fila);
        },
      };
    } }),
    delete: () => ({ where: async (condicion: { queryChunks: { value?: unknown }[] }) => {
      const key = condicion.queryChunks.find((c) => typeof c.value === "string")?.value;
      estado.filas.delete(String(key));
    } }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const antes = new Map(estado.filas);
      try { return await fn(db); } catch (e) { estado.filas = antes; throw e; }
    },
  };
  return { getDb: () => db, schema };
});
vi.mock("@/server/platform/audit", () => ({ auditar: estado.auditoria }));
// La autenticación se prueba en platform-guard*. Aquí no cargar Better Auth
// al importar parseBody: estas pruebas aíslan configuración y sus respuestas.
vi.mock("@/lib/auth/session", () => ({ requireSession: vi.fn(), UnauthorizedError: class extends Error {} }));
vi.mock("@/server/webhooks/recibir", () => ({ recibirEvento: async () => Response.json({ received: true }) }));
vi.mock("@/server/platform/guard", () => ({ withSuperadmin: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) => fn({ userId: "admin" }, ...args) }));

let servicio: typeof import("@/server/platform/config/service");
let cache: typeof import("@/server/platform/config/cache");
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  estado.filas.clear(); estado.error = false; estado.pausa = undefined;
  estado.auditoria.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("PLATAFORMA", "on");
  vi.stubEnv("APP_BASE_URL", "https://crm.test");
  vi.stubEnv("DATABASE_URL", "postgresql://prueba:prueba@localhost/prueba");
  vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-sesion-pruebas");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  for (const key of ["META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "AGENDA", "ATRIBUCION", "CHANNELS", "ALLOW_SIGNUP", "ACCESS_RETENTION_DAYS"]) vi.stubEnv(key, "");
  servicio = await import("@/server/platform/config/service");
  cache = await import("@/server/platform/config/cache");
  cache.invalidarConfig();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("S8 configuración de plataforma", () => {
  it("apagada no consulta ni escribe BD, incluso al calentar o pedir un valor", async () => {
    vi.stubEnv("PLATAFORMA", "off"); vi.stubEnv("AGENDA", "on");
    await servicio.calentarConfig();
    expect(await servicio.valorDeConfig("AGENDA")).toBe(true);
    expect(cache.configSync("AGENDA")).toBe(true);
    await expect(servicio.cambiarConfig("AGENDA", false, "admin")).rejects.toThrow("Plataforma no encontrada");
    expect(estado.lecturas).not.toHaveBeenCalled(); expect(estado.escrituras).not.toHaveBeenCalled();
  });
  it("antes de calentar devuelve el entorno y solicita el refresco en segundo plano", async () => {
    vi.stubEnv("META_APP_SECRET", "respaldo-de-meta");
    expect(cache.configSync("META_APP_SECRET")).toBe("respaldo-de-meta");
    await servicio.calentarConfig();
    expect(estado.lecturas).toHaveBeenCalledTimes(2); // Lectura inicial + token autogenerado.
  });
  it("cifra secretos, DB gana al entorno, API y auditoría solo entregan metadatos", async () => {
    const secreto = "secreto-no-imprimir-1234";
    vi.stubEnv("META_APP_SECRET", "respaldo-de-meta");
    await servicio.cambiarConfig("META_APP_SECRET", secreto, "admin");
    expect(await servicio.valorDeConfig("META_APP_SECRET")).toBe(secreto);
    const fila = estado.filas.get("META_APP_SECRET")!;
    expect(fila.valuePlain).toBeNull(); expect(JSON.stringify(fila)).not.toContain(secreto);
    expect(fila.valueIv).toBeTruthy(); expect(fila.valueTag).toBeTruthy();
    const { GET } = await import("@/app/api/platform/config/route");
    const respuesta = await GET();
    const cuerpo = await respuesta.text();
    expect(cuerpo).not.toContain(secreto); expect(cuerpo).not.toContain("respaldo-de-meta");
    expect(JSON.parse(cuerpo)).toContainEqual(expect.objectContaining({ key: "META_APP_SECRET", origen: "portal", valor: null, ultimos4: "1234" }));
    expect(estado.auditoria).toHaveBeenCalledWith(expect.objectContaining({ action: "config.set", detail: { key: "META_APP_SECRET", secreto: true, cambio: "cambió" } }), expect.anything());
    expect(JSON.stringify(estado.auditoria.mock.calls)).not.toContain(secreto);
  });
  it("Quitar invalida inmediatamente y vuelve al entorno con auditoría atómica", async () => {
    vi.stubEnv("AGENDA", "off");
    await servicio.cambiarConfig("AGENDA", true, "admin");
    expect(cache.configSync("AGENDA")).toBe(true);
    await servicio.cambiarConfig("ATRIBUCION", true, "admin");
    await servicio.cambiarConfig("AGENDA", undefined, "admin", true);
    expect(cache.configSync("AGENDA")).toBe(false);
    expect(cache.configSync("ATRIBUCION")).toBe(true);
    expect(estado.auditoria).toHaveBeenLastCalledWith(expect.objectContaining({ action: "config.clear", detail: { key: "AGENDA", secreto: false, cambio: "cambió" } }), expect.anything());
  });
  it("genera un token cifrado estable entre reinicios del proceso", async () => {
    const token = await servicio.valorDeConfig("META_WEBHOOK_VERIFY_TOKEN");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect((await servicio.listarConfig()).find((f) => f.key === "META_WEBHOOK_VERIFY_TOKEN")?.origen).toBe("autogenerado");
    vi.resetModules();
    const reinicio = await import("@/server/platform/config/service");
    expect(await reinicio.valorDeConfig("META_WEBHOOK_VERIFY_TOKEN")).toBe(token);
    expect(estado.escrituras).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...estado.filas.values()])).not.toContain(token);
  });
  it("dos arranques concurrentes usan el token de la única fila ganadora", async () => {
    const primero = servicio;
    vi.resetModules();
    const segundo = await import("@/server/platform/config/service");
    const [a, b] = await Promise.all([primero.valorDeConfig("META_WEBHOOK_VERIFY_TOKEN"), segundo.valorDeConfig("META_WEBHOOK_VERIFY_TOKEN")]);
    expect(a).toBe(b); expect(a).toHaveLength(64); expect(estado.filas.size).toBe(1);
    expect(estado.escrituras).toHaveBeenCalledTimes(1);
  });
  it("comparte el calentamiento de instrumentation con otra evaluación del módulo en Next", async () => {
    const primeraCache = cache;
    await servicio.cambiarConfig("META_APP_SECRET", "secreto-compartido-1234", "admin");
    vi.resetModules();
    const otraCache = await import("@/server/platform/config/cache");
    expect(otraCache.configSync("META_APP_SECRET")).toBe("secreto-compartido-1234");
    const otroServicio = await import("@/server/platform/config/service");
    await otroServicio.cambiarConfig("AGENDA", true, "admin");
    expect(primeraCache.configSync("AGENDA")).toBe(true);
  });
  it("no genera ni guarda un token cuando existe respaldo en el entorno", async () => {
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "token-del-entorno");
    expect(await servicio.valorDeConfig("META_WEBHOOK_VERIFY_TOKEN")).toBe("token-del-entorno");
    expect(estado.escrituras).not.toHaveBeenCalled();
  });
  it("la procedencia explícita no cambia al eliminar al autor de la configuración", async () => {
    await servicio.cambiarConfig("META_WEBHOOK_VERIFY_TOKEN", "token-del-operador", "admin");
    estado.filas.get("META_WEBHOOK_VERIFY_TOKEN")!.updatedBy = null;
    await servicio.calentarConfig();
    expect((await servicio.listarConfig()).find((f) => f.key === "META_WEBHOOK_VERIFY_TOKEN")?.origen).toBe("portal");
  });
  it("distingue la URL explícita de Zernio del default aun cuando coinciden", async () => {
    expect(cache.configDefinida("ZERNIO_BASE_URL")).toBe(false);
    vi.stubEnv("ZERNIO_BASE_URL", "https://zernio.com/api/v1");
    expect(cache.configDefinida("ZERNIO_BASE_URL")).toBe(true);
    vi.stubEnv("ZERNIO_BASE_URL", "");
    await servicio.cambiarConfig("ZERNIO_BASE_URL", "https://zernio.com/api/v1", "admin");
    expect(cache.configDefinida("ZERNIO_BASE_URL")).toBe(true);
  });
  it("DB caída degrada al entorno, no tumba arranque y registra solo texto fijo", async () => {
    await servicio.cambiarConfig("META_APP_SECRET", "secreto-de-bd-1234", "admin");
    vi.stubEnv("META_APP_SECRET", "respaldo-de-meta");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    estado.error = true;
    await expect(servicio.calentarConfig()).resolves.toBeUndefined();
    expect(cache.configSync("META_APP_SECRET")).toBe("respaldo-de-meta");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[platform] no se pudo leer la configuración; se usa el entorno");
  });
  it("refresca en segundo plano después de 30 s y agrupa consultas concurrentes", async () => {
    vi.useFakeTimers();
    await servicio.calentarConfig(); estado.lecturas.mockClear();
    vi.advanceTimersByTime(30_001);
    const { encryptSecret } = await import("@/lib/crypto");
    const cifrado = encryptSecret(JSON.stringify({ valor: "otro-secreto-1234", autogenerado: false }));
    estado.filas.set("META_APP_SECRET", { key: "META_APP_SECRET", valueCipher: cifrado.cipher, valueIv: cifrado.iv, valueTag: cifrado.tag });
    expect(cache.configSync("META_APP_SECRET")).toBe("");
    cache.configSync("META_APP_SECRET");
    await servicio.calentarConfig();
    expect(cache.configSync("META_APP_SECRET")).toBe("otro-secreto-1234"); expect(estado.lecturas).toHaveBeenCalledTimes(1);
  });
  it("un refresco viejo no publica valores anteriores a un guardado", async () => {
    let resolver!: () => void;
    estado.pausa = new Promise<void>((resolve) => { resolver = resolve; });
    const calentando = servicio.calentarConfig();
    const guardando = servicio.cambiarConfig("AGENDA", true, "admin");
    await Promise.resolve(); estado.pausa = undefined; resolver();
    await Promise.all([calentando, guardando]);
    expect(cache.configSync("AGENDA")).toBe(true);
  });
  it("una auditoría fallida deshace el cambio y su error no contiene secretos", async () => {
    estado.auditoria.mockRejectedValueOnce(new Error("secreto-no-imprimir"));
    await expect(servicio.cambiarConfig("META_APP_SECRET", "secreto-no-imprimir", "admin")).rejects.toThrow("No se pudo guardar la configuración");
    expect(estado.filas.has("META_APP_SECRET")).toBe(false);
  });
  it.each([
    ["AGENDA", true], ["ATRIBUCION", true], ["ALLOW_SIGNUP", true], ["ACCESS_RETENTION_DAYS", 7],
    ["CHANNELS", ["whatsapp", "instagram"]], ["META_GRAPH_API_VERSION", "v26.0"],
    ["ZERNIO_BASE_URL", "https://zernio.test/api"], ["IG_GRAPH_BASE_URL", "https://instagram.test"],
  ] as const)("valida y resuelve %s desde el portal sin reiniciar", async (key, valor) => {
    await servicio.cambiarConfig(key, valor, "admin");
    expect(cache.configSync(key)).toEqual(valor);
  });
  it("las banderas existentes leen la caché del portal", async () => {
    await servicio.cambiarConfig("AGENDA", true, "admin");
    await servicio.cambiarConfig("ATRIBUCION", true, "admin");
    await servicio.cambiarConfig("CHANNELS", ["whatsapp", "instagram"], "admin");
    expect((await import("@/server/agenda/flag")).agendaEnabled()).toBe(true);
    expect((await import("@/server/attribution/flag")).atribucionEnabled()).toBe(true);
    expect((await import("@/server/channels/enabled")).isChannelEnabled("instagram")).toBe(true);
  });
  it("el registro público lee el cambio del portal sin consultas del gate", async () => {
    const { isPublicSignupAllowed } = await import("@/server/auth/registration");
    await servicio.calentarConfig(); expect(await isPublicSignupAllowed()).toBe(false);
    await servicio.cambiarConfig("ALLOW_SIGNUP", true, "admin");
    estado.lecturas.mockClear();
    expect(await isPublicSignupAllowed()).toBe(true); expect(estado.lecturas).not.toHaveBeenCalled();
  });
  it("Graph y los transportes avanzados consultan los valores nuevos en cada llamada", async () => {
    const transporte = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ message_id: "id", id: "id" }));
    vi.stubGlobal("fetch", transporte);
    const { graphRequest } = await import("@/lib/meta/client");
    const { zernioFetch } = await import("@/server/zernio");
    const { sendInstagramText } = await import("@/server/instagram/send");
    await servicio.cambiarConfig("META_GRAPH_API_VERSION", "v26.0", "admin");
    await servicio.cambiarConfig("ZERNIO_BASE_URL", "https://zernio.test/api", "admin");
    await servicio.cambiarConfig("IG_GRAPH_BASE_URL", "https://instagram.test", "admin");
    await graphRequest("numero", { token: "token-de-prueba" });
    expect(transporte.mock.calls.at(-1)?.[0]).toBe("https://graph.facebook.com/v26.0/numero");
    await zernioFetch("/accounts", { token: "token-de-prueba" });
    expect(transporte.mock.calls.at(-1)?.[0]).toBe("https://zernio.test/api/accounts");
    const credentials = { id: "i", organizationId: "o", source: "meta" as const, igUserId: "perfil", accountRef: "cuenta",
      username: null, webhookSecret: null, status: "connected" as const, token: "token-de-prueba" };
    await sendInstagramText({ credentials, recipient: "persona", threadRef: null, text: "Hola" });
    expect(transporte.mock.calls.at(-1)?.[0]).toBe("https://instagram.test/v26.0/perfil/messages");
    await sendInstagramText({ credentials: { ...credentials, source: "zernio" }, recipient: "persona", threadRef: "hilo", text: "Hola" });
    expect(transporte.mock.calls.at(-1)?.[0]).toBe("https://zernio.test/api/inbox/conversations/hilo/messages");
    await servicio.cambiarConfig("META_GRAPH_API_VERSION", "v27.0", "admin");
    await graphRequest("numero", { token: "token-de-prueba" });
    expect(transporte.mock.calls.at(-1)?.[0]).toBe("https://graph.facebook.com/v27.0/numero");
  });
  it("webhook valida la firma del secreto del portal y sin secreto conserva 503", async () => {
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "token-webhook-test");
    const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
    const params = { params: Promise.resolve({ webhookToken: "token-webhook-test" }) };
    const cuerpo = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const req = (secret?: string) => new Request("https://crm.test/", { method: "POST", body: cuerpo,
      headers: secret ? { "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(cuerpo).digest("hex") } : {} });
    await servicio.calentarConfig(); expect((await POST(req(), params)).status).toBe(503);
    await servicio.cambiarConfig("META_APP_SECRET", "secreto-del-portal", "admin");
    expect((await POST(req("secreto-del-portal"), params)).status).toBe(200);
    expect((await POST(req("otro-secreto"), params)).status).toBe(401);
  });
  it("PUT y DELETE no devuelven secretos; rechazan entrada inválida sin repetirla", async () => {
    const { PUT, DELETE } = await import("@/app/api/platform/config/[clave]/route");
    const params = { params: Promise.resolve({ clave: "META_APP_SECRET" }) };
    const req = (valor: unknown) => new Request("https://crm.test/", { method: "PUT", body: JSON.stringify({ valor }) });
    const put = await PUT(req("secreto-no-imprimir-1234"), params);
    expect(put.status).toBe(200); expect(await put.text()).not.toContain("secreto-no-imprimir");
    const invalid = await PUT(req({ secreto: "secreto-no-imprimir" }), params);
    expect(invalid.status).toBe(422); expect(await invalid.text()).not.toContain("secreto-no-imprimir");
    const deleted = await DELETE(req(null), params);
    expect(deleted.status).toBe(200); expect(await deleted.text()).not.toContain("secreto-no-imprimir");
    const desconocida = await PUT(req(true), { params: Promise.resolve({ clave: "ENCRYPTION_KEY" }) });
    expect(desconocida.status).toBe(404);
    const rutaInvalida = await PUT(req("token/con?fragmento"), { params: Promise.resolve({ clave: "META_WEBHOOK_VERIFY_TOKEN" }) });
    expect(rutaInvalida.status).toBe(422); expect(await rutaInvalida.text()).not.toContain("token/con");
  });
  it("rechaza un App secret demasiado corto y acepta uno de tamaño plausible", async () => {
    await expect(servicio.cambiarConfig("META_APP_SECRET", "123456789012345", "admin"))
      .rejects.toThrow("Valor de configuración inválido");
    expect(estado.filas.has("META_APP_SECRET")).toBe(false);
    await servicio.cambiarConfig("META_APP_SECRET", "1234567890123456", "admin");
    expect(cache.configSync("META_APP_SECRET")).toBe("1234567890123456");
  });
  it("errores del driver al guardar producen respuesta y logs sin datos", async () => {
    estado.error = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mutarConfig } = await import("@/server/platform/config/http");
    const respuesta = await mutarConfig(new Request("https://crm.test", { method: "PUT", body: JSON.stringify({ valor: "secreto-no-imprimir" }) }), "META_APP_SECRET", "admin");
    expect(respuesta.status).toBe(503); expect(await respuesta.text()).not.toContain("secreto-no-imprimir");
    expect(log).not.toHaveBeenCalled();
  });
});
