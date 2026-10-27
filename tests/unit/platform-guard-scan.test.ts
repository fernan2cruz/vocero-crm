import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S-1: cada superficie declara su propia guardia, incluso si el layout padre
 * ya la exige. Así una futura ruta no queda pública al moverla de carpeta.
 */
export function archivosSinGuardia(files: readonly { path: string; code: string }[]): string[] {
  return files.filter((file) => !/\b(withSuperadmin|requireSuperadmin)\b/.test(file.code))
    .map((file) => file.path);
}

function superficies(dir: string): { path: string; code: string }[] {
  // S1 no crea pantallas ni endpoints: la ausencia de carpeta es válida.
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return superficies(full);
    if (!/^(route\.ts|page\.tsx|layout\.tsx)$/.test(entry.name)) return [];
    return [{ path: full, code: readFileSync(full, "utf8") }];
  });
}

describe("guardarraíl de plataforma: una sola puerta", () => {
  it("acepta superficies protegidas", () => {
    expect(archivosSinGuardia([
      { path: "route.ts", code: "export const GET = withSuperadmin(handler);" },
      { path: "page.tsx", code: "await requireSuperadmin();" },
    ])).toEqual([]);
  });
  it("detecta una superficie sin guardia", () => {
    expect(archivosSinGuardia([
      { path: "route.ts", code: "export const GET = withAuth(handler);" },
    ])).toEqual(["route.ts"]);
  });
  it("acepta el conjunto vacío de S1", () => {
    expect(archivosSinGuardia([])).toEqual([]);
  });
  it("todas las superficies reales exigen superadmin", () => {
    const app = path.resolve(import.meta.dirname, "../../src/app");
    const infractores = archivosSinGuardia([
      ...superficies(path.join(app, "api/platform")),
      ...superficies(path.join(app, "(platform)")),
    ]);
    expect(infractores, "Usa withSuperadmin o requireSuperadmin en cada superficie").toEqual([]);
  });
});
