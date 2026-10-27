import { createHmac, timingSafeEqual } from "node:crypto";

export const DOMINIO = "vocero:cerebro:v1";

/** El dominio separa esta credencial de otros usos del secreto de despacho. */
export function credencialDerivada(secreto: string, organizationId: string): string {
  return createHmac("sha256", secreto)
    .update(`${DOMINIO}:${organizationId}`)
    .digest("base64url");
}

export function credencialValida(secreto: string, organizationId: string, entregada: string): boolean {
  const esperada = Buffer.from(credencialDerivada(secreto, organizationId));
  const recibida = Buffer.from(entregada);
  // timingSafeEqual exige igual longitud; una entrada truncada no debe lanzar.
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
