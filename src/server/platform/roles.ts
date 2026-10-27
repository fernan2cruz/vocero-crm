import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { auditar } from "./audit";
import { plataformaEnabled } from "./flag";
import { rolUsuarioSchema } from "./schemas";

export async function cambiarRol(input: { userId: string; role: "owner" | "admin" | "member"; actorUserId: string }) {
  if (!plataformaEnabled()) return { ok: false as const, code: "disabled" as const };
  const { role } = rolUsuarioSchema.parse({ role: input.role });
  return getDb().transaction(async (tx) => {
    // Compartido con las altas de superadmin: impide cambiarle el rol durante un alta.
    await tx.execute(sql`LOCK TABLE ${schema.platformAdmin} IN SHARE ROW EXCLUSIVE MODE`);
    const [admin] = await tx.select({ id: schema.platformAdmin.userId }).from(schema.platformAdmin)
      .where(eq(schema.platformAdmin.userId, input.userId));
    if (admin) return { ok: false as const, code: "is_superadmin" as const };
    const miembros = await tx.select({ id: schema.member.id, organizationId: schema.member.organizationId })
      .from(schema.member).where(eq(schema.member.userId, input.userId));
    if (!miembros.length) return { ok: false as const, code: "no_membership" as const };
    // Sin organizationId en el contrato no se puede elegir una membresía arbitraria.
    if (miembros.length !== 1) return { ok: false as const, code: "ambiguous_membership" as const };
    const miembro = miembros[0]!;
    // Serializar por negocio impide que dos degradaciones simultáneas borren sus owners.
    await tx.select({ id: schema.organization.id }).from(schema.organization)
      .where(eq(schema.organization.id, miembro.organizationId)).for("update");
    const [actual] = await tx.select({ role: schema.member.role }).from(schema.member)
      .where(eq(schema.member.id, miembro.id)).for("update");
    if (!actual) return { ok: false as const, code: "no_membership" as const };
    if (actual.role === "owner" && role !== "owner") {
      const propietarios = await tx.select({ id: schema.member.id }).from(schema.member)
        .where(and(eq(schema.member.organizationId, miembro.organizationId), eq(schema.member.role, "owner")));
      if (propietarios.length <= 1) return { ok: false as const, code: "last_owner" as const };
    }
    if (actual.role === role) return { ok: true as const };
    await tx.update(schema.member).set({ role }).where(eq(schema.member.id, miembro.id));
    await auditar({ actorUserId: input.actorUserId, action: "user.role", organizationId: miembro.organizationId,
      targetUserId: input.userId, detail: { from: actual.role, to: role } }, tx);
    return { ok: true as const };
  });
}
