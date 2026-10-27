import { describe, expect, it } from "vitest";
import { motivosDeRiesgo } from "@/server/platform/riesgo";

const ahora = new Date("2026-10-27T12:00:00Z");
const base = { aiMode: "platform" as const, saldoMicros: 20, acreditadoMicros: 100,
  agenteEncendido: true, webhooksAgotados: 0, suspendido: false, ultimaSenal: ahora, ahora };
describe("riesgos puros por negocio", () => {
  it("20% exacto no es bajo; cero y negativos son sin crédito", () => {
    expect(motivosDeRiesgo(base)).toEqual([]);
    expect(motivosDeRiesgo({ ...base, saldoMicros: 19 })).toEqual(["credito_bajo"]);
    for (const saldoMicros of [0, -1]) expect(motivosDeRiesgo({ ...base, saldoMicros })).toEqual(["sin_credito"]);
  });
  it("llave propia ignora saldo y sin acreditaciones no inventa bajo", () => {
    expect(motivosDeRiesgo({ ...base, aiMode: "own_key", saldoMicros: 0 })).toEqual([]);
    expect(motivosDeRiesgo({ ...base, acreditadoMicros: 0 })).toEqual([]);
  });
  it("distingue señal nula, caducada y frontera de 24h", () => {
    expect(motivosDeRiesgo({ ...base, ultimaSenal: null })).toEqual(["cerebro_sin_senal"]);
    expect(motivosDeRiesgo({ ...base, ultimaSenal: new Date(+ahora - 86_400_000) })).toEqual([]);
    expect(motivosDeRiesgo({ ...base, ultimaSenal: new Date(+ahora - 86_400_001) })).toEqual(["cerebro_sin_senal"]);
  });
  it("acumula motivos sin exigir señal a un agente apagado", () => {
    expect(motivosDeRiesgo({ ...base, saldoMicros: 0, agenteEncendido: false, webhooksAgotados: 1, suspendido: true, ultimaSenal: null }))
      .toEqual(["sin_credito", "agente_apagado", "webhooks_agotados", "suspendido"]);
  });
});
