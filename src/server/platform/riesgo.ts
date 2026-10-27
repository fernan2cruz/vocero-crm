export type MotivoRiesgo = "sin_credito" | "credito_bajo" | "agente_apagado" | "webhooks_agotados" | "suspendido" | "cerebro_sin_senal";
export function motivosDeRiesgo(d: {
  aiMode: "platform" | "own_key"; saldoMicros: number; acreditadoMicros: number;
  agenteEncendido: boolean; webhooksAgotados: number; suspendido: boolean;
  ultimaSenal: Date | null; ahora: Date;
}): MotivoRiesgo[] {
  const motivos: MotivoRiesgo[] = [];
  if (d.aiMode === "platform") {
    if (d.saldoMicros <= 0) motivos.push("sin_credito");
    else if (d.saldoMicros < d.acreditadoMicros / 5) motivos.push("credito_bajo");
  }
  if (!d.agenteEncendido) motivos.push("agente_apagado");
  if (d.webhooksAgotados > 0) motivos.push("webhooks_agotados");
  if (d.suspendido) motivos.push("suspendido");
  if (d.agenteEncendido && (d.ultimaSenal === null || d.ahora.getTime() - d.ultimaSenal.getTime() > 86_400_000)) motivos.push("cerebro_sin_senal");
  return motivos;
}
