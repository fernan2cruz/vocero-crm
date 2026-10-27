import { describe, expect, it } from "vitest";
import { decidirRevocacion } from "@/server/platform/admins";

describe("decidir revocación de superadmin", () => {
  it("no permite revocar sin administradores", () => {
    expect(decidirRevocacion([], "a", "b")).toEqual({ ok: false, code: "not_admin" });
  });
  it("rechaza un destino que no es administrador", () => {
    expect(decidirRevocacion(["a", "b"], "a", "c")).toEqual({ ok: false, code: "not_admin" });
  });
  it("rechaza un actor que no es administrador", () => {
    expect(decidirRevocacion(["a", "b"], "c", "b")).toEqual({ ok: false, code: "not_admin" });
  });
  it("impide al único administrador quitarse", () => {
    expect(decidirRevocacion(["a"], "a", "a")).toEqual({ ok: false, code: "last_admin" });
  });
  it("un actor ajeno tampoco puede quitar al único administrador", () => {
    expect(decidirRevocacion(["a"], "b", "a")).toEqual({ ok: false, code: "not_admin" });
  });
  it("permite quitar a otro cuando queda un administrador", () => {
    expect(decidirRevocacion(["a", "b"], "a", "b")).toEqual({ ok: true });
  });
  it("permite quitarse si queda otro administrador", () => {
    expect(decidirRevocacion(["a", "b"], "a", "a")).toEqual({ ok: true });
  });
  it("no confunde ids repetidos con varios administradores ni muta la entrada", () => {
    const ids = Object.freeze(["a", "a"]);
    expect(decidirRevocacion(ids, "a", "a")).toEqual({ ok: false, code: "last_admin" });
    expect(ids).toEqual(["a", "a"]);
  });
});
