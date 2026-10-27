import { randomBytes } from "node:crypto";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Rechazo de bytes fuera del múltiplo evita sesgo al elegir cada carácter. */
export function generarContrasenaTemporal(): string {
  let resultado = "";
  const limite = 256 - (256 % ALFABETO.length);
  while (resultado.length < 20) {
    for (const byte of randomBytes(32)) {
      if (byte < limite) resultado += ALFABETO[byte % ALFABETO.length]!;
      if (resultado.length === 20) break;
    }
  }
  return resultado;
}
