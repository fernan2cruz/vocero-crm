import { describe, expect, it } from "vitest";
import { estadoDeCredito } from "@/server/platform/credito-estado";
import { etiquetaAccion, resumenDetalle } from "@/lib/platform-ui";

describe("estado del crédito de IA", () => {
  it("agotado con saldo cero o negativo", () => {
    expect(estadoDeCredito(0, 10_000_000)).toBe("agotado");
    expect(estadoDeCredito(-5, 10_000_000)).toBe("agotado");
  });
  it("bajo por debajo del 20 % de lo acreditado y ok desde el 20 %", () => {
    expect(estadoDeCredito(1_999_999, 10_000_000)).toBe("bajo");
    expect(estadoDeCredito(2_000_000, 10_000_000)).toBe("ok");
    expect(estadoDeCredito(9_000_000, 10_000_000)).toBe("ok");
  });
  it("sin nada acreditado y con saldo positivo no alarma", () => {
    expect(estadoDeCredito(1, 0)).toBe("ok");
  });
  it("las alertas se muestran en español, sin JSON crudo", () => {
    expect(etiquetaAccion("credit.low")).toBe("Crédito de IA bajo");
    expect(etiquetaAccion("credit.depleted")).toBe("Crédito de IA agotado");
    expect(resumenDetalle("credit.depleted", { balanceAfter: -1000 })).toContain("Saldo");
  });
});
