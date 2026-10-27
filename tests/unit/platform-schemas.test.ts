import { describe, expect, it } from "vitest";
import { accionNegocioSchema, accionUsuarioSchema, crearNegocioSchema,
  editarNegocioSchema, listarUsuariosSchema, motivoSchema, notasNegocioSchema } from "@/server/platform/schemas";

describe("esquemas de plataforma", () => {
  it("valida el alta y normaliza el correo", () => {
    const valido = { name: "Tienda", ownerName: "Ana", ownerEmail: "ANA@example.com" };
    expect(crearNegocioSchema.parse(valido).ownerEmail).toBe("ana@example.com");
    expect(crearNegocioSchema.safeParse({ ...valido, tempPassword: "abcdefgh" }).success).toBe(true);
    for (const extra of [{ name: " " }, { ownerName: "" }, { ownerEmail: "mal" },
      { tempPassword: "corta" }, { tempPassword: "a".repeat(129) }, { action: "otra" }]) {
      expect(crearNegocioSchema.safeParse({ ...valido, ...extra }).success).toBe(false);
    }
  });
  it("exige motivos de 3 a 300 caracteres", () => {
    for (const reason of ["abc", "a".repeat(300)]) {
      expect(motivoSchema.safeParse(reason).success).toBe(true);
      expect(accionNegocioSchema.safeParse({ action: "suspend", reason }).success).toBe(true);
      expect(accionUsuarioSchema.safeParse({ action: "disable", reason }).success).toBe(true);
    }
    for (const reason of ["aa", "a".repeat(301), "  ", undefined]) {
      expect(motivoSchema.safeParse(reason).success).toBe(false);
      expect(editarNegocioSchema.safeParse({ action: "suspend", reason }).success).toBe(false);
      expect(accionUsuarioSchema.safeParse({ action: "disable", reason }).success).toBe(false);
    }
  });
  it("valida acciones y rechaza desconocidas o mezcladas", () => {
    expect(editarNegocioSchema.safeParse({ action: "reactivate" }).success).toBe(true);
    for (const action of ["enable", "reset_password"]) {
      expect(accionUsuarioSchema.safeParse({ action }).success).toBe(true);
    }
    for (const esquema of [accionNegocioSchema, editarNegocioSchema, accionUsuarioSchema]) {
      expect(esquema.safeParse({ action: "desconocida" }).success).toBe(false);
      expect(esquema.safeParse({ action: "desconocida", notes: "texto" }).success).toBe(false);
      expect(esquema.safeParse({}).success).toBe(false);
    }
  });
  it("valida notas y filtros", () => {
    for (const notes of [null, "", "Nota"]) {
      expect(notasNegocioSchema.safeParse({ notes }).success).toBe(true);
      expect(editarNegocioSchema.safeParse({ notes }).success).toBe(true);
    }
    expect(notasNegocioSchema.safeParse({ notes: "a".repeat(10001) }).success).toBe(false);
    expect(listarUsuariosSchema.safeParse({}).success).toBe(true);
    expect(listarUsuariosSchema.safeParse({ q: "José", organizationId: "org_1" }).success).toBe(true);
    for (const entrada of [{ q: "a".repeat(201) }, { organizationId: "" }, { action: "otra" }]) {
      expect(listarUsuariosSchema.safeParse(entrada).success).toBe(false);
    }
  });
});
