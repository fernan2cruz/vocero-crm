import { rellenarVariables } from "@/lib/respuestas-rapidas";

/**
 * 064 — Lógica pura del envío de una campaña. Sin base ni red: el servidor le
 * inyecta cómo tomar, enviar y marcar, y así se prueba sin mandar un mensaje.
 */

/** Tope por campaña: una lista más grande merece revisarse en partes. */
export const MAX_RECIPIENTS = 500;
/** Pausa entre envíos: Meta limita el ritmo y un golpe masivo se rechaza. */
export const THROTTLE_MS = 250;
const LOTE = 20;

/** Errores tras los cuales seguir sería inútil o dañino: se corta la campaña. */
export const CODIGOS_FATALES = new Set(["not_connected", "reconnect_required", "sandbox_violation", "limite_diario", "negocio_suspendido"]);

export type EstadoDestinatario = "sent" | "failed" | "skipped";

export type Destinatario = { id: string; contactId: string; nombre: string };

export type CampanaDeps = {
  tomar(n: number): Promise<Destinatario[]>;
  enviar(d: Destinatario, valores: string[]): Promise<void>;
  marcar(id: string, estado: EstadoDestinatario, detalle: string | null): Promise<void>;
  cancelada(): Promise<boolean>;
  pausa(ms: number): Promise<void>;
};

export type ResultadoCampana = {
  estado: "completa" | "cancelada" | "interrumpida";
  enviados: number;
  fallidos: number;
  omitidos: number;
  /** Por qué se interrumpió, si fue así. */
  motivo?: string;
};

/**
 * Los valores de {{1}}..{{n}} para UN contacto. `faltan` = alguno quedó vacío
 * (típico: `{nombre}` de alguien sin nombre de pila): Meta rechaza un
 * parámetro vacío, así que a esa persona se le omite en vez de mandar roto.
 */
export function valoresPara(
  plantilla: string[],
  nombre: string | null | undefined
): { valores: string[]; faltan: boolean } {
  const valores = plantilla.map((v) => rellenarVariables(v, nombre).trim());
  return { valores, faltan: valores.some((v) => !v) };
}

function codigoDe(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "error";
}

function mensajeDe(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 300);
}

/**
 * Envía a los pendientes, de uno en uno, hasta acabar, cancelar o toparse con
 * un error fatal. Nunca repite: solo `tomar` entrega pendientes, y cada uno se
 * marca antes de pasar al siguiente.
 */
export async function procesarCampana(
  deps: CampanaDeps,
  plantilla: string[],
  opts: { throttleMs?: number } = {}
): Promise<ResultadoCampana> {
  const throttle = opts.throttleMs ?? THROTTLE_MS;
  const res: ResultadoCampana = { estado: "completa", enviados: 0, fallidos: 0, omitidos: 0 };

  for (;;) {
    if (await deps.cancelada()) return { ...res, estado: "cancelada" };
    const lote = await deps.tomar(LOTE);
    if (lote.length === 0) return res;

    for (const d of lote) {
      if (await deps.cancelada()) return { ...res, estado: "cancelada" };
      const { valores, faltan } = valoresPara(plantilla, d.nombre);
      if (faltan) {
        await deps.marcar(d.id, "skipped", "Sin nombre para completar la plantilla");
        res.omitidos++;
        continue;
      }
      try {
        await deps.enviar(d, valores);
        await deps.marcar(d.id, "sent", null);
        res.enviados++;
      } catch (err) {
        if (codigoDe(err) === "ya_reclamado") continue;
        if (CODIGOS_FATALES.has(codigoDe(err))) {
          // Sin marcar: sigue pendiente y se reanuda cuando se arregle.
          return { ...res, estado: "interrumpida", motivo: codigoDe(err) === "limite_diario" ? "limite_diario" : mensajeDe(err) };
        }
        await deps.marcar(d.id, "failed", mensajeDe(err));
        res.fallidos++;
      }
      await deps.pausa(throttle);
    }
  }
}
