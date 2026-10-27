import { z } from "zod";

export const motivoSchema = z.string().trim().min(3).max(300);
export const crearNegocioSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().email().toLowerCase(),
  tempPassword: z.string().min(8).max(128).optional(),
}).strict();
export const accionNegocioSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_ai_mode"), aiMode: z.enum(["own_key", "platform"]) }).strict(),
  z.object({ action: z.literal("suspend"), reason: motivoSchema }).strict(),
  z.object({ action: z.literal("reactivate") }).strict(),
]);
export const notasNegocioSchema = z.object({ notes: z.string().trim().max(10000).nullable() }).strict();
// Las notas no llevan action en el contrato; las acciones sí son discriminadas.
export const editarNegocioSchema = z.union([accionNegocioSchema, notasNegocioSchema]);
export const accionUsuarioSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable"), reason: motivoSchema }).strict(),
  z.object({ action: z.literal("enable") }).strict(),
  z.object({ action: z.literal("reset_password") }).strict(),
]);
export const listarUsuariosSchema = z.object({
  q: z.string().trim().max(200).optional(),
  organizationId: z.string().trim().min(1).max(200).optional(),
}).strict();

// El ORM usa number para bigint: rechazar lo que JS no puede representar exactamente.
export const microsSchema = z.number().int().safe();
export const creditoSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), amountMicros: microsSchema.positive(), note: z.string().trim().min(3).max(200) }).strict(),
  z.object({ action: z.literal("adjust"), amountMicros: microsSchema.refine((n) => n !== 0), note: z.string().trim().min(3).max(200) }).strict(),
]);
export const precioIaSchema = z.object({
  model: z.string().trim().min(1).max(200),
  inputPerMillionMicros: microsSchema.nonnegative(),
  outputPerMillionMicros: microsSchema.nonnegative(),
}).strict();

const idAccesoSchema = z.string().trim().min(1).max(200);
const limiteAccesoSchema = z.coerce.number().int().min(1).max(200).default(200);
const periodoAccesoSchema = z.object({
  from: z.string().optional(), to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
});
export const eventosAccesoSchema = periodoAccesoSchema.extend({
  organizationId: idAccesoSchema.optional(), kind: z.enum(["success", "failure"]).optional(),
  limit: limiteAccesoSchema,
}).strict();
export const alertasAccesoSchema = z.object({
  ventanaHoras: z.coerce.number().int().min(1).max(8784).default(24),
}).strict();
export const sesionesSchema = z.object({
  organizationId: idAccesoSchema.optional(), userId: idAccesoSchema.optional(), limit: limiteAccesoSchema,
}).strict();
export const accionSesionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), sessionId: idAccesoSchema }).strict(),
  z.object({ action: z.literal("revoke_user"), userId: idAccesoSchema }).strict(),
  z.object({ action: z.literal("revoke_org"), organizationId: idAccesoSchema }).strict(),
]);
export const rolUsuarioSchema = z.object({ role: z.enum(["owner", "admin", "member"]) }).strict();
export const cursorAuditoriaSchema = z.string().transform((valor, ctx) => {
  const [fecha, id, extra] = valor.split("|");
  const createdAt = new Date(fecha ?? "");
  if (!fecha || !id || id.length > 200 || extra !== undefined || !Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== fecha) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cursor inválido" });
    return z.NEVER;
  }
  return { createdAt, id };
});
export const auditoriaSchema = periodoAccesoSchema.extend({
  organizationId: idAccesoSchema.optional(), actorUserId: idAccesoSchema.optional(),
  accion: z.string().trim().min(1).max(200).optional(), limit: limiteAccesoSchema,
  antes: cursorAuditoriaSchema.optional(),
}).strict();
