import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { listarNegocios } from "@/server/platform/tenants";
import { NegociosClient } from "@/components/platform/negocios-client";

export const dynamic = "force-dynamic";

export default async function NegociosPage() {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  return <NegociosClient negocios={await listarNegocios()} />;
}
