import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { ajustesIaPlataforma, preciosDeIa } from "@/server/platform/ai-usage";
import { IaClient } from "@/components/platform/ia-client";
import { AI_PROVIDERS } from "@/lib/ai/presets";

export const dynamic = "force-dynamic";

export default async function IaPage() {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const [llave, precios] = await Promise.all([ajustesIaPlataforma(), preciosDeIa()]);
  return <IaClient llave={{ ...llave, provider: AI_PROVIDERS.find((p) => p === llave.provider) ?? null }} precios={precios} />;
}
