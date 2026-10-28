import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, it } from "vitest";
import { clavesConfig } from "@/server/platform/config/registry";

it("el .env de despliegue ya no genera configuración del portal ni IA", () => {
  const ejemplo = parseEnv(readFileSync("deploy/.env.example", "utf8"));
  for (const key of clavesConfig) expect(ejemplo).not.toHaveProperty(key);
  for (const key of Object.keys(ejemplo)) expect(key).not.toMatch(/^OPENROUTER_/);
  for (const key of ["DOMAIN", "POSTGRES_PASSWORD", "ENCRYPTION_KEY", "BETTER_AUTH_SECRET", "BOT_API_KEY", "PLATAFORMA"]) expect(ejemplo).toHaveProperty(key);
  expect(ejemplo.PLATAFORMA).toBe("on");
  const generador = readFileSync("deploy/scripts/gen-env.sh", "utf8");
  expect([...generador.matchAll(/^sub (\w+) /gm)].map((m) => m[1])).toEqual(["DOMAIN", "POSTGRES_PASSWORD", "BETTER_AUTH_SECRET", "ENCRYPTION_KEY", "BOT_API_KEY"]);
  expect(generador).toContain("/platform/configuracion");
});
it("compose conserva .env antiguos sin duplicar los ajustes movidos en environment", () => {
  const compose = readFileSync("deploy/docker-compose.prod.yml", "utf8");
  const app = compose.split(/\n  app:\r?\n/)[1]!.split(/\n  nea:\r?\n/)[0]!;
  expect(app).toContain("env_file: [.env]");
  for (const key of clavesConfig) expect(app).not.toMatch(new RegExp(`^\\s+${key}:`, "m"));
  expect(app).not.toMatch(/^\s+OPENROUTER_\w+:/m);
  expect(app).toContain("META_GRAPH_BASE_URL:");
});
it("0033 crea solo la configuración global y referencia al usuario con set null", () => {
  const sql = readFileSync("drizzle/0033_config_plataforma.sql", "utf8");
  expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1])).toEqual(["platform_config"]);
  expect(sql).toMatch(/PRIMARY KEY/); expect(sql).toMatch(/ON DELETE set null/);
  expect(sql).not.toContain("organization_id");
});
