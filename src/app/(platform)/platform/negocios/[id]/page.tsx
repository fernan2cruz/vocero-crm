import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { obtenerNegocio } from "@/server/platform/tenants";
import { esSuperadmin } from "@/server/platform/admins";
import { NegocioClient } from "@/components/platform/negocio-client";
import { saldoDe, libroDe } from "@/server/platform/credit";
import { modoIaDe } from "@/server/platform/ai-usage";
import { getAiCredentialPublic } from "@/server/ai/credentials";
import { vistaLlaveIa } from "@/server/ai/settings";

export const dynamic = "force-dynamic";

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const negocio = await obtenerNegocio((await params).id);
  if (!negocio) notFound();
  const usuarios = await Promise.all(negocio.usuarios.map(async (u) => ({
    ...u, id: u.userId, esSuperadmin: await esSuperadmin(u.userId),
  })));
  const [saldo, libro, modo, credencial] = await Promise.all([
    saldoDe(negocio.id), libroDe(negocio.id, { limit: 20 }), modoIaDe(negocio.id), getAiCredentialPublic(negocio.id),
  ]);
  return <NegocioClient key={negocio.id} negocio={negocio} usuarios={usuarios}
    credito={{ id: negocio.id, saldo, libro, modo }} llave={vistaLlaveIa(credencial)} />;
}
