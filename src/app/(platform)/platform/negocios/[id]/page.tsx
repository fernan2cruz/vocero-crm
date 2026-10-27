import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { obtenerNegocio } from "@/server/platform/tenants";
import { esSuperadmin } from "@/server/platform/admins";
import { NegocioClient } from "@/components/platform/negocio-client";

export const dynamic = "force-dynamic";

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const negocio = await obtenerNegocio((await params).id);
  if (!negocio) notFound();
  const usuarios = await Promise.all(negocio.usuarios.map(async (u) => ({
    ...u, id: u.userId, esSuperadmin: await esSuperadmin(u.userId),
  })));
  return <NegocioClient key={negocio.id} negocio={negocio} usuarios={usuarios} />;
}
