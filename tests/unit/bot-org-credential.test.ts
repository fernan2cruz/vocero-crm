import { describe, expect, it } from "vitest";
import { DOMINIO, credencialDerivada, credencialValida } from "@/server/bot/org-credential";

const SECRETO = "0123456789abcdef0123456789abcdef";

describe("contrato de credenciales de Nea", () => {
  it.each([
    [SECRETO, "org_abc123", "35xQLucxgNu2V_i1FU6XZE9x9gYYH7W5CaTS4HoN2NI"],
    [SECRETO, "org_xyz789", "d5SrG-VOghQfSSRJ9qUzCgPW7Gvd1tCOR3jQ-AH1ytk"],
    [SECRETO, "org_p6tfcmmeavg8k3ya9i1d", "xdk7Phv1vCRBgyks0GFZwhEiaEzXy0HRmCzWYrjfMBE"],
    ["ffffffffffffffffffffffffffffffff", "org_abc123", "eWeOqUXQrS7ioBWxo0k_nLL8diEjAHZumzrFoe0foJE"],
  ])("fija el vector %s / %s", (secreto, org, esperada) => {
    expect(DOMINIO).toBe("vocero:cerebro:v1");
    expect(credencialDerivada(secreto, org)).toBe(esperada);
    expect(credencialValida(secreto, org, esperada)).toBe(true);
  });

  it("no acepta otro secreto ni otro negocio", () => {
    const llave = credencialDerivada(SECRETO, "org_abc123");
    expect(credencialValida("f".repeat(32), "org_abc123", llave)).toBe(false);
    expect(credencialValida(SECRETO, "org_xyz789", llave)).toBe(false);
  });

  it.each(["", "x", "x".repeat(42), "x".repeat(44), "ñ".repeat(43)])(
    "rechaza longitudes distintas sin lanzar (%s)", (llave) => {
      expect(() => credencialValida(SECRETO, "org_abc123", llave)).not.toThrow();
      expect(credencialValida(SECRETO, "org_abc123", llave)).toBe(false);
    }
  );
});
