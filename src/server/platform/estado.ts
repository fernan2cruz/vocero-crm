import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

// Auth y los trabajos solo necesitan estas lecturas; separarlas evita que
// carguen las operaciones de alta que a su vez dependen de Better Auth.
export async function estadoDeNegocio(organizationId: string): Promise<"active" | "suspended"> {
  const [fila] = await getDb().select({ status: schema.organizationPlatform.status })
    .from(schema.organizationPlatform).where(eq(schema.organizationPlatform.organizationId, organizationId)).limit(1);
  return fila?.status ?? "active";
}

export async function usuarioDesactivado(userId: string): Promise<boolean> {
  const [fila] = await getDb().select({ id: schema.userPlatform.userId }).from(schema.userPlatform)
    .where(eq(schema.userPlatform.userId, userId)).limit(1);
  return !!fila;
}
