import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { auditar } from "@/server/platform/audit";
import { creditoSchema, microsSchema } from "@/server/platform/schemas";

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function saldoDe(organizationId: string): Promise<number> {
  const [fila] = await getDb().select().from(schema.aiCreditAccount)
    .where(scoped(schema.aiCreditAccount.organizationId, organizationId)).limit(1);
  return microsSchema.parse(fila?.balanceMicros ?? 0);
}

/** El conflicto bloquea la cuenta: nunca se calcula un saldo con una lectura previa. */
export async function moverSaldo(tx: Transaction, organizationId: string, amountMicros: number) {
  microsSchema.parse(amountMicros);
  const [fila] = await tx.insert(schema.aiCreditAccount).values({ organizationId, balanceMicros: amountMicros })
    .onConflictDoUpdate({ target: schema.aiCreditAccount.organizationId,
      set: { balanceMicros: sql`${schema.aiCreditAccount.balanceMicros} + ${amountMicros}` } })
    .returning({ balanceMicros: schema.aiCreditAccount.balanceMicros });
  // Si se excede la precisión del ORM se revierte toda la transacción.
  return microsSchema.parse(fila?.balanceMicros);
}

type Movimiento = { organizationId: string; amountMicros: number; note: string; actorUserId: string };
async function registrarCredito(input: Movimiento, kind: "grant" | "adjust") {
  const datos = creditoSchema.parse({ action: kind, amountMicros: input.amountMicros, note: input.note });
  return getDb().transaction(async (tx) => {
    const balanceAfter = await moverSaldo(tx, input.organizationId, datos.amountMicros);
    await tx.insert(schema.aiCreditLedger).values({ id: newId("aiCreditLedger"),
      organizationId: input.organizationId, kind, amountMicros: datos.amountMicros,
      balanceAfter, note: datos.note, actorUserId: input.actorUserId });
    await auditar({ actorUserId: input.actorUserId, action: "credit.adjust",
      organizationId: input.organizationId, targetUserId: null,
      detail: { kind, amountMicros: datos.amountMicros, balanceAfter, note: datos.note } }, tx);
    return balanceAfter;
  });
}
export function acreditar(input: Movimiento) { return registrarCredito(input, "grant"); }
export function ajustar(input: Movimiento) { return registrarCredito(input, "adjust"); }

export async function libroDe(organizationId: string, { limit = 200 }: { limit?: number } = {}) {
  const limite = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 200;
  return getDb().select().from(schema.aiCreditLedger)
    .where(scoped(schema.aiCreditLedger.organizationId, organizationId))
    .orderBy(desc(schema.aiCreditLedger.createdAt), desc(schema.aiCreditLedger.id)).limit(limite);
}
