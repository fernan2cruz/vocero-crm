/**
 * 065 — Puerta global, sin scoped(): pasa el userId explícito al dominio.
 * No exige membresía: un superadmin puede no pertenecer a ningún negocio.
 */
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { esSuperadmin } from "@/server/platform/admins";
import { plataformaEnabled, plataformaDisabledResponse } from "@/server/platform/flag";

export type PlatformSession = { userId: string; email: string };

export class PlataformaNoEncontrada extends Error {
  constructor() {
    super("Plataforma no encontrada");
    this.name = "PlataformaNoEncontrada";
  }
}

export async function getPlatformSession(): Promise<PlatformSession | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session ? { userId: session.user.id, email: session.user.email } : null;
}

/** La bandera precede incluso a auth: apagada no consulta ni sesión ni base. */
export function withSuperadmin<Args extends unknown[]>(
  handler: (session: PlatformSession, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    if (!plataformaEnabled()) return plataformaDisabledResponse();
    try {
      const session = await getPlatformSession();
      if (!session) return apiError(401, "unauthorized", "No autenticado");
      if (!(await esSuperadmin(session.userId))) return plataformaDisabledResponse();
      return await handler(session, ...args);
    } catch (err) {
      console.error("[platform] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** Las páginas traducen solo esta excepción a notFound(); los fallos reales se propagan. */
export async function requireSuperadmin(): Promise<PlatformSession> {
  if (!plataformaEnabled()) throw new PlataformaNoEncontrada();
  const session = await getPlatformSession();
  if (!session || !(await esSuperadmin(session.userId))) throw new PlataformaNoEncontrada();
  return session;
}
