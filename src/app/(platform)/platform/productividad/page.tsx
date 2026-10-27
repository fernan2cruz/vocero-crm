import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { productividadPorNegocio } from "@/server/platform/productividad";
import type { ParametrosPagina } from "@/lib/platform-ui";
import { PeriodoInforme, periodoInforme } from "@/components/platform/periodo-informe";
import { TablaProductividad } from "@/components/platform/tabla-productividad";

export const dynamic = "force-dynamic";

export default async function ProductividadPage({ searchParams }: { searchParams: Promise<ParametrosPagina> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const { periodo, error } = periodoInforme(await searchParams);
  const negocios = error ? null : await productividadPorNegocio(periodo);
  return <><h1 className="text-2xl font-semibold">Productividad</h1><PeriodoInforme periodo={periodo} error={error} />{negocios && <TablaProductividad negocios={negocios} />}</>;
}
