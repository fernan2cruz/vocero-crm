import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { obtenerNegocio } from "@/server/platform/tenants";
import { esSuperadmin } from "@/server/platform/admins";
import { NegocioClient } from "@/components/platform/negocio-client";
import { saldoDe, libroDe } from "@/server/platform/credit";
import { modoIaDe } from "@/server/platform/ai-usage";
import { getAiCredentialPublic } from "@/server/ai/credentials";
import { vistaLlaveIa } from "@/server/ai/settings";
import Link from "next/link";
import { consumoPorNegocio } from "@/server/platform/consumo";
import { productividadPorNegocio } from "@/server/platform/productividad";
import { resolverPeriodo } from "@/server/platform/periodo";
import { formatearMicros, formatearDuracion } from "@/lib/platform-ui";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const negocio = await obtenerNegocio((await params).id);
  if (!negocio) notFound();
  const usuarios = await Promise.all(negocio.usuarios.map(async (u) => ({
    ...u, id: u.userId, esSuperadmin: await esSuperadmin(u.userId),
  })));
  const periodo = resolverPeriodo({ days: 30 });
  const [saldo, libro, modo, credencial, consumos, productividades] = await Promise.all([
    saldoDe(negocio.id), libroDe(negocio.id, { limit: 20 }), modoIaDe(negocio.id), getAiCredentialPublic(negocio.id),
    consumoPorNegocio(periodo), productividadPorNegocio(periodo),
  ]);
  const consumo = consumos.find((n) => n.organizationId === negocio.id);
  const productividad = productividades.find((n) => n.organizationId === negocio.id);
  return <NegocioClient key={negocio.id} negocio={negocio} usuarios={usuarios}
    credito={{ id: negocio.id, saldo, libro, modo }} llave={vistaLlaveIa(credencial)} informes={<section aria-label="Informes de los últimos 30 días" className="grid gap-4 sm:grid-cols-2">
      <Card><CardHeader><CardTitle>Consumo</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">Últimos 30 días · UTC</p>
        <p>{formatearMicros(consumo?.costoMicros ?? 0)} USD · {consumo?.llamadas ?? 0} llamadas</p>
        <p>{consumo?.tokensEntrada ?? 0} tokens de entrada / {consumo?.tokensSalida ?? 0} de salida</p>
        <Link className="text-primary underline" href={`/platform/consumo?organizationId=${encodeURIComponent(negocio.id)}`}>Ver consumo del negocio</Link>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Productividad</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">Últimos 30 días · UTC · Sin Laboratorio</p>
        <p>{productividad?.conversaciones ?? 0} conversaciones · {productividad?.mensajesEntrantes ?? 0} entrantes / {productividad?.mensajesSalientes ?? 0} salientes</p>
        <p>Primera respuesta: {formatearDuracion(productividad?.primeraRespuestaMedianaSeg ?? null)}</p>
        <p>{productividad?.traspasos ?? 0} traspasos · {productividad?.tratosGanados ?? 0} tratos ganados</p>
      </CardContent></Card>
    </section>} />;
}
