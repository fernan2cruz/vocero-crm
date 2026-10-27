import { z } from "zod";
import { apiError } from "@/lib/api";
import { PeriodoInvalido, resolverPeriodo } from "./periodo";
import { toCsv } from "@/lib/csv";
import type { consumoPorNegocio } from "./consumo";

const consulta = z.object({ from: z.string().optional(), to: z.string().optional(),
  days: z.string().regex(/^\d+$/, "days debe ser un entero entre 1 y 366").transform(Number).optional(),
  organizationId: z.string().trim().min(1, "organizationId no puede estar vacío").max(200).optional() });

export function parametrosInforme(req: Request) {
  const datos = consulta.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!datos.success) throw new PeriodoInvalido(datos.error.issues.map((i) => i.message).join("; "));
  return { periodo: resolverPeriodo(datos.data), organizationId: datos.data.organizationId };
}
/** También las denegaciones de la guardia llevan no-store. */
export function informeSinCache(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const respuesta = await handler(req);
    respuesta.headers.set("Cache-Control", "no-store");
    return respuesta;
  };
}
export async function responderInforme(req: Request, handler: (p: ReturnType<typeof parametrosInforme>) => Promise<Response>) {
  try { return await handler(parametrosInforme(req)); }
  catch (e) {
    if (e instanceof PeriodoInvalido) return apiError(422, "invalid_query", e.message);
    throw e;
  }
}
export function csvConsumo(filas: Awaited<ReturnType<typeof consumoPorNegocio>>) {
  return toCsv(["Negocio", "Llamadas", "Tokens entrada", "Tokens salida", "Costo USD", "Bot llamadas", "Bot USD", "Laboratorio llamadas", "Laboratorio USD", "Juez llamadas", "Juez USD"],
    filas.map((r) => [r.nombre, r.llamadas, r.tokensEntrada, r.tokensSalida, (r.costoMicros / 1_000_000).toFixed(6),
      r.porFuente.bot.llamadas, (r.porFuente.bot.costoMicros / 1_000_000).toFixed(6),
      r.porFuente.lab.llamadas, (r.porFuente.lab.costoMicros / 1_000_000).toFixed(6),
      r.porFuente.judge.llamadas, (r.porFuente.judge.costoMicros / 1_000_000).toFixed(6)]));
}
