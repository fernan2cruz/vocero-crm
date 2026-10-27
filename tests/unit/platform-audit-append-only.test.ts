import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(RAIZ, "src");
const DRIZZLE = path.join(RAIZ, "drizzle");

/** La auditoría solo admite inserciones; el hecho debe sobrevivir al negocio. */
function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(dir, entrada.name);
    return entrada.isDirectory() ? archivos(ruta) : [ruta];
  });
}

function modificaAuditoria(codigo: string): boolean {
  return /\.\s*(?:update|delete)\s*\(\s*schema\s*\.\s*platformAudit\s*\)/.test(codigo);
}

function borraAuditoriaEnCascada(sql: string): boolean {
  return sql.split(";").some((sentencia) =>
    /\b(?:ALTER|CREATE)\s+TABLE\s+(?:"?\w+"?\.)?"?platform_audit"?\s/i.test(sentencia) &&
    /\bREFERENCES\s+(?:"?\w+"?\.)?"?organization"?\s*\([^)]*\)[^,;]*\bON\s+DELETE\s+CASCADE\b/i.test(sentencia)
  );
}

describe("guardarraíl: la auditoría de plataforma es append-only", () => {
  it("ningún archivo de src actualiza ni elimina platformAudit", () => {
    const infractores = archivos(SRC)
      .filter((ruta) => modificaAuditoria(readFileSync(ruta, "utf8")))
      .map((ruta) => path.relative(RAIZ, ruta));
    expect(infractores, "La auditoría solo admite inserciones").toEqual([]);
  });

  it("ninguna migración borra la auditoría al eliminar una organización", () => {
    const infractores = readdirSync(DRIZZLE)
      .filter((nombre) => nombre.endsWith(".sql"))
      .filter((nombre) => borraAuditoriaEnCascada(readFileSync(path.join(DRIZZLE, nombre), "utf8")));
    expect(infractores, "El hecho debe sobrevivir al negocio; usa ON DELETE set null").toEqual([]);
  });

  it.each([
    "db.update(schema.platformAudit).set({ action: 'alterada' })",
    "db.delete(schema.platformAudit)",
    "db\n .update (\n schema . platformAudit\n )",
    "db\n .delete (\n schema . platformAudit\n )",
  ])("detecta la escritura prohibida: %s", (codigo) => {
    expect(modificaAuditoria(codigo)).toBe(true);
  });

  it("detecta una FK sintética con la cascada rechazada", () => {
    const sql = 'ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;';
    expect(borraAuditoriaEnCascada(sql)).toBe(true);
    expect(borraAuditoriaEnCascada(sql.replace("DELETE cascade", "DELETE set null"))).toBe(false);
    expect(borraAuditoriaEnCascada(sql.replaceAll('"platform_audit"', '"ai_usage"'))).toBe(false);
  });

  it("permite insertar auditoría y modificar otras tablas", () => {
    expect(modificaAuditoria("db.insert(schema.platformAudit).values({})")).toBe(false);
    expect(modificaAuditoria("db.update(schema.aiUsage).set({})")).toBe(false);
    expect(modificaAuditoria("db.delete(schema.aiCreditLedger)")).toBe(false);
  });
});
