import { expect, it } from "vitest";
import { generarContrasenaTemporal } from "@/server/platform/password";

it("genera 200 contraseñas largas, sin ambigüedades y sin repetición", () => {
  const valores = Array.from({ length: 200 }, generarContrasenaTemporal);
  expect(new Set(valores).size).toBe(200);
  for (const valor of valores) {
    expect(valor.length).toBeGreaterThanOrEqual(16);
    expect(valor).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]+$/);
    expect(valor).not.toMatch(/[0Ool1I]/);
  }
});
