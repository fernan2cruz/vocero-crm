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
