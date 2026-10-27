import { describe, expect, it } from "vitest";
import { parsePlataformaFlag } from "@/server/platform/flag";

describe("bandera de plataforma", () => {
  it.each(["on", "1", "true", "si", "sí", "yes"])("enciende con %s, mayúsculas y espacios", (valor) => {
    expect(parsePlataformaFlag(valor)).toBe(true);
    expect(parsePlataformaFlag(`  ${valor.toUpperCase()}  `)).toBe(true);
  });
  it.each([undefined, "", "  ", "off", "0", "no", " OFF ", "cualquier cosa"])("apaga con %s", (valor) => {
    expect(parsePlataformaFlag(valor)).toBe(false);
  });
});
