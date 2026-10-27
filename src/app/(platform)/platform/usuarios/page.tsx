import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { listarUsuarios } from "@/server/platform/users";
import { listarNegocios } from "@/server/platform/tenants";
import { listarUsuariosSchema } from "@/server/platform/schemas";
import { UsuariosClient } from "@/components/platform/usuarios-client";

export const dynamic = "force-dynamic";

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const parametros = await searchParams;
  const filtros = listarUsuariosSchema.safeParse({
    q: parametros.q === "" ? undefined : parametros.q,
    organizationId: parametros.organizationId === "" ? undefined : parametros.organizationId,
  });
  const negocios = await listarNegocios();
  if (!filtros.success) return <UsuariosClient usuarios={[]} negocios={negocios} filtros={{}} error="Los filtros no son válidos. Escribe hasta 200 caracteres y selecciona un negocio." />;
  const usuarios = await listarUsuarios(filtros.data);
  return <UsuariosClient key={JSON.stringify(filtros.data)} usuarios={usuarios} negocios={negocios} filtros={filtros.data} />;
}
