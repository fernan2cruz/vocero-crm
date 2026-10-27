"use client";

export class ErrorPlataforma extends Error {
  constructor(public code: string, mensaje: string) { super(mensaje); }
}

export async function peticion(ruta: string, metodo: "POST" | "PATCH", cuerpo: unknown): Promise<{ contrasenaTemporal?: string }> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  } catch { throw new Error("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo."); }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new ErrorPlataforma(datos?.error?.code ?? "internal", datos?.error?.message ?? "No se pudo completar la acción.");
  return datos;
}

export function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo completar la acción.";
}
