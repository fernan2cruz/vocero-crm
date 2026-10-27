/**
 * 065 — Bootstrap global, sin scoped(): el correo resuelve un userId explícito.
 * Se empaqueta con esbuild como seed:demo. No exige PLATAFORMA ni lee .env:
 * las credenciales de conexión llegan por el entorno del operador.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, getSql, schema } from "@/lib/db";
import { otorgarSuperadmin } from "@/server/platform/admins";

const correo = z.string().trim().email().safeParse(process.argv[2]);
if (!correo.success || process.argv.length !== 3) {
  console.error("Uso: pnpm platform:grant correo@ejemplo.com");
  process.exit(1);
}

let conexion: ReturnType<typeof getSql> | undefined;
try {
  conexion = getSql();
  const [usuario] = await getDb().select({ id: schema.user.id }).from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${correo.data.toLowerCase()}`).limit(1);
  if (!usuario) {
    console.error("[platform] No existe un usuario con ese correo. Crea la cuenta primero.");
    process.exitCode = 1;
  } else {
    await otorgarSuperadmin({ userId: usuario.id, grantedBy: null });
    console.log("[platform] Permiso de superadmin concedido (o ya existente).");
  }
} catch {
  // Una excepción de conexión puede contener credenciales: no se imprime.
  console.error("[platform] No se pudo otorgar el permiso. Revisa el entorno y la base de datos.");
  process.exitCode = 1;
} finally {
  // No crea una conexión si la validación del entorno falló antes de abrirla.
  await conexion?.end();
}
