/**
 * S8: PostgreSQL real, dos procesos Next y navegador. Solo admite una base
 * local vacía cuyo nombre termine en _s8. No usa credenciales ni Meta reales.
 * Uso: node --env-file=.env.s8 scripts/e2e-configuracion-plataforma.mjs
 * Requiere pnpm build; S8_CONSERVAR=1 deja los procesos vivos para revisión.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as servidorHttp } from "node:http";
import { createServer as servidorTcp, connect } from "node:net";
import { chromium } from "playwright";
import { build } from "esbuild";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const raiz = process.cwd();
const conexion = new URL(process.env.DATABASE_URL ?? "http://sin-base");
assert(["localhost", "127.0.0.1"].includes(conexion.hostname) && /_s8$/.test(conexion.pathname),
  "Usa exclusivamente una base local descartable terminada en _s8");
const sql = postgres(conexion.toString(), { max: 2, onnotice() {}, connection: { TimeZone: "UTC" } });
const temporales = path.join(raiz, ".tmp", "s8");
await mkdir(temporales, { recursive: true });
const procesos = new Set();
const servidores = new Set();
const base = "http://localhost:3310";
const env = { ...process.env, PLATAFORMA: "on", APP_BASE_URL: base,
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
delete env.META_APP_SECRET;
delete env.META_WEBHOOK_VERIFY_TOKEN;
const clave = "0123456789abcdef0123456789abcdef";
const contrasena = "PruebaS8-descartable-2026";
let comprobaciones = 0;
function verificar(condicion, descripcion) {
  assert(condicion, descripcion); comprobaciones++; console.log(`✓ ${descripcion}`);
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(fn, descripcion, ms = 45_000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    try { if (await fn()) return; } catch { /* Esperar disponibilidad. */ }
    await pausa(250);
  }
  throw new Error(`Tiempo agotado: ${descripcion}`);
}
async function arrancar(puerto, extra = {}) {
  const hijo = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(puerto)],
    { cwd: raiz, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  procesos.add(hijo);
  hijo.salida = "";
  for (const flujo of [hijo.stdout, hijo.stderr]) flujo.on("data", (d) => { hijo.salida += d.toString(); });
  await esperar(async () => {
    if (hijo.exitCode !== null) throw new Error("Next terminó antes de arrancar");
    return (await fetch(`http://localhost:${puerto}/login`)).ok;
  }, `Next en ${puerto}`);
  return hijo;
}
async function parar(hijo) {
  if (hijo.exitCode === null) {
    const termino = new Promise((r) => hijo.once("exit", r));
    hijo.kill(); await termino;
  }
  procesos.delete(hijo);
}
async function peticion(ruta, { cookie, valor, method = "GET", puerto = 3310, ...opciones } = {}) {
  return fetch(`http://localhost:${puerto}${ruta}`, { method, ...opciones,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(valor !== undefined ? { "Content-Type": "application/json" } : {}), ...opciones.headers },
    ...(valor !== undefined ? { body: JSON.stringify({ valor }) } : {}) });
}
async function login(correo) {
  const respuesta = await peticion("/api/auth/sign-in/email", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email: correo, password: contrasena }) });
  assert.equal(respuesta.status, 200, "Inicio de sesión");
  return respuesta.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
}
let navegador;
try {
  const tablas = await sql`select tablename from pg_tables where schemaname = 'public'`;
  assert.equal(tablas.length, 0, "La base debe estar vacía");
  // Usar el migrador real primero con el journal anterior, sin editar SQL.
  const migraciones = path.join(temporales, "drizzle");
  await cp(path.join(raiz, "drizzle"), migraciones, { recursive: true });
  const journalPath = path.join(migraciones, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= 32) }));
  await migrate(drizzle(sql), { migrationsFolder: migraciones });
  const antes = await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  await sql`insert into "user" (id,name,email) values ('s8-preservar','Preservar','preservar@s8.test')`;
  await sql`insert into organization (id,name,slug) values ('s8-preservar','Preservar','s8-preservar')`;
  await sql`insert into organization_limits (organization_id,max_messages_per_day) values ('s8-preservar',7)`;
  await migrate(drizzle(sql), { migrationsFolder: path.join(raiz, "drizzle") });
  const despues = await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`;
  verificar(despues.length === antes.length + 1 && despues.some((t) => t.tablename === "platform_config"), "0032 → 0033 crea solo platform_config");
  verificar((await sql`select max_messages_per_day from organization_limits where organization_id='s8-preservar'`)[0].max_messages_per_day === 7,
    "La actualización conserva los límites existentes");
  verificar(Number((await sql`select count(*) as n from drizzle.__drizzle_migrations`)[0].n) === journal.entries.length, "Journal de migraciones completo");
  await migrate(drizzle(sql), { migrationsFolder: path.join(raiz, "drizzle") });
  verificar(true, "Las migraciones se pueden reejecutar");

  await build({ stdin: { contents: `
    import { getAuth, runInternalSignup } from '@/lib/auth';
    import { getDb, getSql, schema } from '@/lib/db';
    import { sembrarNegocio } from '@/server/auth/on-signup';
    import { decryptSecret } from '@/lib/crypto';
    import { calentarConfig, valorDeConfig } from '@/server/platform/config/service';
    import { configSync } from '@/server/platform/config/cache';
    import { graphRequest } from '@/lib/meta/client';
    import { zernioFetch } from '@/server/zernio';
    import { sendInstagramText } from '@/server/instagram/send';
    export { calentarConfig, valorDeConfig, decryptSecret };
    export async function probarTransporte() {
      await calentarConfig();
      await graphRequest('s8-sondeo', {token:'ficticio'});
      await zernioFetch('/s8-sondeo', {token:'ficticio'});
      await sendInstagramText({credentials:{source:'meta',igUserId:'s8',token:'ficticio'},recipient:'cliente-s8',threadRef:null,text:'Prueba local'});
    }
    export async function sondear() {
      await calentarConfig();
      return {agenda:configSync('AGENDA'), token:!!configSync('META_WEBHOOK_VERIFY_TOKEN'), secreto:!!configSync('META_APP_SECRET')};
    }
    export async function sembrar(password) {
      const admin = await runInternalSignup(() => getAuth().api.signUpEmail({body:{name:'Superadmin S8', email:'admin@s8.test',password}}));
      const miembro = await runInternalSignup(() => getAuth().api.signUpEmail({body:{name:'Miembro S8',email:'miembro@s8.test',password}}));
      await getDb().insert(schema.platformAdmin).values({userId:admin.user.id});
      const org = await getDb().transaction(tx => sembrarNegocio(tx,{name:'Negocio S8',ownerUserId:miembro.user.id}));
      await getSql().unsafe('update member set role = $1 where user_id = $2',['member',miembro.user.id]);
      return org;
    }
    export async function cerrar() { await getSql().end(); }
  `, resolveDir: raiz, sourcefile: "s8-fixtures.ts", loader: "ts" },
    bundle: true, platform: "node", format: "esm", packages: "external", alias: { "@": path.join(raiz, "src") },
    outfile: path.join(raiz, ".tmp-s8-fixtures.mjs"), logLevel: "silent" });
  Object.assign(process.env, env);
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  const fixtures = await import(pathToFileURL(path.join(raiz, ".tmp-s8-fixtures.mjs")).href);
  await fixtures.sembrar(contrasena);
  await fixtures.cerrar();

  let [principal, secundario] = await Promise.all([arrancar(3310), arrancar(3311)]);
  let cookie = await login("admin@s8.test");
  const miembro = await login("miembro@s8.test");
  const catalogo = () => peticion("/api/platform/config", { cookie }).then((r) => r.json());
  const tokenGuardado = async () => {
    const [fila] = await sql`select * from platform_config where key='META_WEBHOOK_VERIFY_TOKEN'`;
    return JSON.parse(fixtures.decryptSecret({ cipher: fila.value_cipher, iv: fila.value_iv, tag: fila.value_tag })).valor;
  };
  let token = await tokenGuardado();
  verificar((await catalogo()).find((f) => f.key === "META_WEBHOOK_VERIFY_TOKEN").origen === "autogenerado", "Token autogenerado en el primer arranque");
  verificar((await sql`select count(*) as n from platform_config where key='META_WEBHOOK_VERIFY_TOKEN'`)[0].n === "1", "Dos arranques simultáneos comparten una sola fila");
  verificar((await peticion(`/api/webhooks/wa/${token}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=s8`)).status === 200, "Handshake con el token persistido");
  verificar((await peticion(`/api/webhooks/wa/${token}`, { method: "POST", body: "{}" })).status === 503, "Sin App secret no se aceptan entregas");
  await parar(principal); principal = await arrancar(3310);
  verificar(await tokenGuardado() === token, "El token sobrevive al reinicio");
  cookie = await login("admin@s8.test");
  const guardar = async (key, valor) => {
    const r = await peticion(`/api/platform/config/${key}`, { cookie, method: "PUT", valor });
    assert.equal(r.status, 200, `Guardar ${key}`); return r.json();
  };
  const secreto = await guardar("META_APP_SECRET", clave);
  verificar(secreto.valor === null && secreto.ultimos4 === clave.slice(-4), "El catálogo solo devuelve los últimos cuatro del secreto");
  const [fila] = await sql`select * from platform_config where key='META_APP_SECRET'`;
  verificar(fila.value_plain === null && fila.value_cipher && fila.value_iv && fila.value_tag && !JSON.stringify(fila).includes(clave), "App secret cifrado en PostgreSQL");
  await guardar("CHANNELS", ["whatsapp", "instagram", "messenger"]);
  for (const [canal, objeto] of [["wa", "whatsapp_business_account"], ["ig", "instagram"], ["messenger", "page"]]) {
    const body = JSON.stringify({ object: objeto, entry: [] });
    const firma = `sha256=${createHmac("sha256", clave).update(body).digest("hex")}`;
    for (const [signature, estado] of [[firma, 200], ["sha256=invalida", 401], [null, 401]]) {
      const r = await peticion(`/api/webhooks/${canal}/${token}`, { method: "POST", body,
        headers: signature ? { "x-hub-signature-256": signature } : {} });
      verificar(r.status === estado, `${canal}: firma ${estado === 200 ? "válida" : signature ? "incorrecta" : "ausente"} → ${estado}`);
    }
  }
  for (const [key, valor] of [["ACCESS_RETENTION_DAYS", -1], ["ALLOW_SIGNUP", "true"], ["CHANNELS", ["desconocido"]],
    ["META_GRAPH_API_VERSION", "incorrecta"], ["IG_GRAPH_BASE_URL", "https://usuario:secreto@example.test"]]) {
    const r = await peticion(`/api/platform/config/${key}`, { cookie, method: "PUT", valor });
    verificar(r.status === 422 && !(await r.text()).includes(JSON.stringify(valor)), `${key}: rechaza el valor inválido sin repetirlo`);
  }
  verificar((await peticion("/api/platform/config/ENCRYPTION_KEY", { cookie, method: "PUT", valor: "prohibida" })).status === 404, "ENCRYPTION_KEY no pertenece al catálogo");
  verificar((await peticion("/api/platform/config", { cookie: miembro })).status === 404, "Miembro: API de plataforma 404");
  verificar((await peticion("/platform/configuracion", { cookie: miembro })).status === 404, "Miembro: página de plataforma 404");
  verificar((await peticion("/api/platform/config")).status === 401, "Sin sesión: API 401");
  verificar(JSON.stringify(await (await peticion("/api/settings/webhook", { cookie: miembro })).json()) === '{"gestionado":true}', "El negocio recibe solo gestionado:true");
  await guardar("AGENDA", true); await guardar("ATRIBUCION", true);
  await guardar("ACCESS_RETENTION_DAYS", 90); await guardar("META_GRAPH_API_VERSION", "v24.0");
  verificar((await (await peticion("/api/health")).json()).features.agenda === true, "Agenda se aplica sin reiniciar");
  verificar((await (await peticion("/api/health")).json()).features.atribucion === true, "Atribución se aplica sin reiniciar");
  verificar((await peticion("/api/bookings", { cookie: miembro })).status === 200, "Agenda habilitada en la API del negocio");
  await esperar(async () => (await (await peticion("/api/platform/config", { cookie, puerto: 3311 })).json()).find((f) => f.key === "ACCESS_RETENTION_DAYS").valor === 90,
    "refresco entre procesos", 40_000);
  verificar(true, "El segundo proceso refresca la configuración al vencer los 30 segundos");
  await guardar("ALLOW_SIGNUP", true);
  const alta = await peticion("/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name: "Registro S8", email: "registro@s8.test", password: contrasena }) });
  verificar(alta.status === 200, "El registro público cambia sin reiniciar");
  await guardar("ALLOW_SIGNUP", false);
  const cerrada = await peticion("/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name: "Cerrado S8", email: "cerrado@s8.test", password: contrasena }) });
  verificar(cerrada.status === 403, "El registro vuelve a cerrarse sin reiniciar");
  verificar(!JSON.stringify(await catalogo()).includes(clave) && !(await sql`select detail from platform_audit where action like 'config.%'`).some((a) => JSON.stringify(a).includes(clave)), "Catálogo y auditoría no filtran el App secret");

  await parar(secundario);
  secundario = await arrancar(3311, { META_APP_SECRET: "respaldo-meta-s8-ficticio", META_WEBHOOK_VERIFY_TOKEN: "respaldo-token-s8" });
  const conRespaldo = await (await peticion("/api/platform/config", { cookie, puerto: 3311 })).json();
  verificar(conRespaldo.find((f) => f.key === "META_APP_SECRET").origen === "portal", "BD prevalece sobre el respaldo del entorno");
  const quitado = await peticion("/api/platform/config/META_APP_SECRET", { cookie, puerto: 3311, method: "DELETE" });
  verificar((await quitado.json()).origen === "env", "Quitar vuelve al respaldo del entorno");
  await parar(secundario);
  await guardar("META_APP_SECRET", clave);

  const apagado = await arrancar(3312, { PLATAFORMA: "", META_WEBHOOK_VERIFY_TOKEN: "historico-s8-token" });
  verificar((await peticion("/api/platform/config", { cookie, puerto: 3312 })).status === 404 &&
    (await peticion("/platform/configuracion", { cookie, puerto: 3312 })).status === 404, "PLATAFORMA apagada: API y portal 404");
  verificar((await (await peticion("/api/health", { puerto: 3312 })).json()).features.agenda === false, "PLATAFORMA apagada: banderas del entorno");
  await parar(apagado);

  // Un proceso aislado vuelve a conectar a la misma dirección al recuperarse
  // un proxy TCP. No se detiene ni modifica el PostgreSQL del operador.
  let consultasConfig = 0;
  const proxy = servidorTcp((cliente) => {
    const destino = connect(Number(conexion.port), conexion.hostname);
    cliente.on("data", (datos) => { if (datos.includes(Buffer.from("platform_config"))) consultasConfig++; });
    cliente.pipe(destino).pipe(cliente);
    cliente.on("error", () => destino.destroy());
    destino.on("error", () => cliente.destroy());
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const puertoProxy = proxy.address().port;
  await new Promise((r) => proxy.close(r));
  const urlProxy = new URL(conexion); urlProxy.port = String(puertoProxy);
  urlProxy.searchParams.set("connect_timeout", "2");
  const modulo = pathToFileURL(path.join(raiz, ".tmp-s8-fixtures.mjs")).href;
  const trabajador = spawn(process.execPath, ["--input-type=module", "-e", `
    const f = await import(${JSON.stringify(modulo)});
    process.on('message', async () => { try {process.send(await f.sondear());} catch {process.send({error:true});} });
  `], { cwd: raiz, env: { ...env, DATABASE_URL: urlProxy.toString() }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  procesos.add(trabajador);
  trabajador.salida = "";
  trabajador.stdout.on("data", (d) => { trabajador.salida += d.toString(); });
  trabajador.stderr.on("data", (d) => { trabajador.salida += d.toString(); });
  const sondear = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("El refresco no terminó")), 40_000);
    trabajador.once("message", (m) => { clearTimeout(timer); resolve(m); }); trabajador.send("refrescar");
  });
  const caida = await sondear();
  verificar(caida.agenda === false && caida.token === false && caida.secreto === false, "BD caída: entorno/default sin token ni secreto inventados");
  verificar(trabajador.salida.trim() === "[platform] no se pudo leer la configuración; se usa el entorno", "Fallo de configuración: log fijo sin error del driver");
  const arranqueSinBd = await arrancar(3312, { DATABASE_URL: urlProxy.toString() });
  verificar((await peticion("/api/webhooks/wa/token-no-disponible", { puerto: 3312 })).status === 404,
    "App con BD caída: arranca y no autentica sin verify token");
  await parar(arranqueSinBd);
  const arranqueConRespaldo = await arrancar(3312, { DATABASE_URL: urlProxy.toString(), META_WEBHOOK_VERIFY_TOKEN: "caida-s8-token" });
  verificar((await peticion("/api/webhooks/wa/caida-s8-token", { puerto: 3312, method: "POST", body: "{}" })).status === 503,
    "App con BD caída: sin App secret rechaza entregas aunque la URL autentique");
  await parar(arranqueConRespaldo);
  await new Promise((r) => proxy.listen(puertoProxy, "127.0.0.1", r));
  servidores.add(proxy);
  verificar((await sondear()).agenda === true, "Recuperar PostgreSQL permite refrescar sin reiniciar el proceso");
  await parar(trabajador);
  const consultasAntes = consultasConfig;
  const sinPlataforma = await arrancar(3312, { DATABASE_URL: urlProxy.toString(), PLATAFORMA: "", META_WEBHOOK_VERIFY_TOKEN: "historico-s8-token" });
  verificar((await peticion("/api/health", { puerto: 3312 })).status === 200 && consultasConfig === consultasAntes,
    "PLATAFORMA apagada: el proceso y sus workers no consultan platform_config (proxy SQL)");
  await parar(sinPlataforma);

  // Los adaptadores reales hablan únicamente con este mock local.
  const llamadas = [];
  const mock = servidorHttp((req, res) => {
    llamadas.push(req.url); req.resume();
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ message_id: "s8-mensaje", id: "s8-mensaje" }));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r)); servidores.add(mock);
  const origenMock = `http://127.0.0.1:${mock.address().port}`;
  await guardar("ZERNIO_BASE_URL", `${origenMock}/zernio`);
  await guardar("IG_GRAPH_BASE_URL", `${origenMock}/instagram`);
  const transporte = spawn(process.execPath, ["--input-type=module", "-e", `
    const f = await import(${JSON.stringify(modulo)});
    try {await f.probarTransporte();} finally {await f.cerrar();}
  `], { cwd: raiz, env: { ...env, META_GRAPH_BASE_URL: origenMock }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  procesos.add(transporte);
  let salidaTransporte = "";
  transporte.stderr.on("data", (d) => { salidaTransporte += d.toString(); });
  const estadoTransporte = await new Promise((r) => transporte.once("exit", r)); procesos.delete(transporte);
  assert.equal(estadoTransporte, 0, `Adaptadores con mock: ${salidaTransporte}`);
  verificar(llamadas.includes("/v24.0/s8-sondeo") && llamadas.includes("/zernio/s8-sondeo") && llamadas.includes("/instagram/v24.0/s8/messages"),
    "Graph, Zernio e Instagram usan la versión y los hosts del portal");

  // Dejar vacía la fila antes de arrancar dos procesos prueba la carrera real.
  await parar(principal);
  await sql`delete from platform_config where key='META_WEBHOOK_VERIFY_TOKEN'`;
  [principal, secundario] = await Promise.all([arrancar(3310), arrancar(3311)]);
  token = await tokenGuardado();
  for (const puerto of [3310, 3311]) {
    verificar((await peticion(`/api/webhooks/wa/${token}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=s8`, { puerto })).status === 200,
      `Arranque concurrente ${puerto}: el handshake usa el token ganador`);
  }
  await parar(secundario);
  const anterior = token;
  const borrado = await peticion("/api/platform/config/META_WEBHOOK_VERIFY_TOKEN", { cookie, method: "DELETE" });
  token = await tokenGuardado();
  verificar(borrado.status === 200 && token !== anterior && (await borrado.json()).origen === "autogenerado", "Quitar el token sin respaldo genera otro cifrado");
  verificar((await peticion(`/api/webhooks/wa/${anterior}`)).status === 404, "El token anterior deja de autenticar");

  // El navegador ejerce formularios, teclado, portapapeles y ambos temas.
  navegador = await chromium.launch({ channel: "chrome", headless: true });
  const contexto = await navegador.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const pagina = await contexto.newPage();
  const erroresUi = []; pagina.on("pageerror", (e) => erroresUi.push(e.message));
  await pagina.goto(`${base}/login`);
  await pagina.getByRole("textbox", { name: "Correo" }).fill("admin@s8.test");
  await pagina.getByRole("textbox", { name: "Contraseña" }).fill(contrasena);
  await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
  await pagina.waitForURL("**/platform/negocios");
  await pagina.goto(`${base}/platform/configuracion`);
  await pagina.getByRole("button", { name: "Editar App secret de Meta", exact: true }).click();
  const campoSecreto = pagina.getByLabel("App secret de Meta", { exact: true });
  verificar(await campoSecreto.inputValue() === "" && await campoSecreto.getAttribute("type") === "password" &&
    await campoSecreto.getAttribute("autocomplete") === "new-password", "Navegador: secreto vacío, password y new-password");
  await pagina.keyboard.press("Escape");
  verificar(await pagina.getByRole("button", { name: "Editar App secret de Meta", exact: true }).evaluate((e) => e === document.activeElement), "Escape cierra el diálogo y devuelve el foco");
  await pagina.getByRole("button", { name: "Editar Retención de accesos (días)", exact: true }).click();
  await pagina.getByLabel("Retención de accesos (días)", { exact: true }).fill("-1");
  await pagina.getByRole("button", { name: "Guardar", exact: true }).click();
  await pagina.getByRole("alert").filter({ hasText: "Valor de configuración inválido" }).waitFor();
  verificar(true, "Navegador: el formulario presenta el error de validación accesible");
  await pagina.getByLabel("Retención de accesos (días)", { exact: true }).fill("91");
  await pagina.getByRole("button", { name: "Guardar", exact: true }).click();
  await pagina.getByRole("dialog").waitFor({ state: "detached" });
  await esperar(async () => (await catalogo()).find((f) => f.key === "ACCESS_RETENTION_DAYS").valor === 91, "persistencia del formulario");
  verificar(true, "Navegador: guardar actualiza PostgreSQL y cierra el diálogo");
  await pagina.getByRole("button", { name: "Quitar App secret de Meta", exact: true }).click();
  await pagina.getByRole("button", { name: "Cancelar", exact: true }).click();
  verificar((await catalogo()).find((f) => f.key === "META_APP_SECRET").configurado, "Cancelar Quitar conserva la configuración");
  for (const nombre of ["Copiar URL de WhatsApp", "Copiar Verify token"]) {
    await pagina.getByRole("button", { name: nombre, exact: true }).click();
    const texto = await pagina.evaluate(() => navigator.clipboard.readText());
    verificar(texto === (nombre.includes("URL") ? `${base}/api/webhooks/wa/${token}` : token), `Portapapeles: ${nombre}`);
  }
  await mkdir(path.join(raiz, "output", "playwright"), { recursive: true });
  for (const ancho of [375, 1440]) for (const tema of ["light", "dark"]) {
    await pagina.setViewportSize({ width: ancho, height: 900 });
    await pagina.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    verificar(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Sin desborde: ${ancho}px, tema ${tema}`);
    await pagina.screenshot({ path: path.join(raiz, "output", "playwright", `s8-${ancho}-${tema}.png`), fullPage: true, animations: "disabled" });
  }
  verificar(erroresUi.length === 0, "Navegador sin excepciones de JavaScript");
  await navegador.close(); navegador = undefined;

  console.log(`S8: ${comprobaciones} comprobaciones de API/PostgreSQL/navegador aprobadas.`);
  await writeFile(path.join(temporales, "resultado.json"), JSON.stringify({ fecha: new Date().toISOString(), comprobaciones }, null, 2));
  if (process.env.S8_CONSERVAR === "1") {
    console.log("Procesos conservados en localhost:3310 para revisar el navegador. Ctrl+C termina el arnés.");
    await new Promise((r) => { process.once("SIGINT", r); process.once("SIGTERM", r); });
  }
} finally {
  await navegador?.close();
  for (const hijo of procesos) await parar(hijo);
  for (const servidor of servidores) servidor.close();
  await sql.end();
  await rm(path.join(temporales, "drizzle"), { recursive: true, force: true });
}
