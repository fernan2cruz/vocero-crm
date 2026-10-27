import { describe, expect, it } from "vitest";
import { tituloConNoLeidos } from "@/components/avisos-de-mensajes";

/** 045 — El contador de la pestaña, como «(3) WhatsApp». */
describe("tituloConNoLeidos", () => {
  it("antepone los chats sin leer", () => {
    expect(tituloConNoLeidos("Wassapi — CRM", 3)).toBe("(3) Wassapi — CRM");
  });
  it("sin pendientes deja el título limpio", () => {
    expect(tituloConNoLeidos("(3) Wassapi — CRM", 0)).toBe("Wassapi — CRM");
  });
  it("no apila contadores al actualizar", () => {
    expect(tituloConNoLeidos("(3) Wassapi — CRM", 5)).toBe("(5) Wassapi — CRM");
  });
  it("más de 99 se muestra como 99+", () => {
    expect(tituloConNoLeidos("Wassapi", 140)).toBe("(99+) Wassapi");
    expect(tituloConNoLeidos("(99+) Wassapi", 2)).toBe("(2) Wassapi");
  });
});
