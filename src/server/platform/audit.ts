/**
 * 065 — Auditoría global, sin scoped(): actor y destinos son ids explícitos.
 * Solo inserta; compartir transacción evita cambios sin su rastro de auditoría.
 */
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

export type PlatformAction =
  | "limits.set"
  | "platform.admin.grant"
  | "platform.admin.revoke"
  | "org.create"
  | "org.suspend"
  | "org.reactivate"
  | "credit.adjust"
  | "credit.low"
  | "credit.depleted"
  | "ai_key.set"
  | "ai.mode"
  | "ai.price"
  | "ai_key.revoke"
  | "session.revoke"
  | "user.disable"
  | "user.role"
  | "user.password_reset"
  | "org.notes"
  | "user.enable";

export type PlatformAuditEntry = {
  actorUserId: string | null;
  action: PlatformAction;
  organizationId: string | null;
  targetUserId: string | null;
  /** Metadatos de la acción, nunca secretos ni contenido de conversaciones. */
  detail: Record<string, unknown>;
};

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function auditar(entry: PlatformAuditEntry, tx?: Transaction): Promise<void> {
  await (tx ?? getDb()).insert(schema.platformAudit).values({
    id: newId("platformAudit"),
    ...entry,
  });
}
