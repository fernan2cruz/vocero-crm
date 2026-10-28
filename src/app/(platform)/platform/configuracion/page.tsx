import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { listarConfig, valorDeConfig } from "@/server/platform/config/service";
import { ajustesIaPlataforma } from "@/server/platform/ai-usage";
import { webhookUrl } from "@/server/whatsapp/webhook-url";
import { ConfiguracionClient } from "@/components/platform/configuracion-client";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const [filas, ia, token] = await Promise.all([listarConfig(), ajustesIaPlataforma(), valorDeConfig("META_WEBHOOK_VERIFY_TOKEN")]);
  // Única presentación completa del verify token: página protegida del operador.
  return <ConfiguracionClient filas={filas} iaConfigurada={ia.configurada} webhook={{ url: webhookUrl(), token }} />;
}
