import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { alertasDeAcceso, eventosDeAcceso } from "@/server/platform/accesos";
import { listarSesiones } from "@/server/platform/sesiones";
import { listarNegocios } from "@/server/platform/tenants";
import { listarUsuarios } from "@/server/platform/users";
import { sesionesSchema, eventosAccesoSchema } from "@/server/platform/schemas";
import { formatoFecha, navegadorLegible, etiquetaResultadoAcceso, type ParametrosPagina } from "@/lib/platform-ui";
import { PeriodoInforme, periodoInforme } from "@/components/platform/periodo-informe";
import { TablaSeguridad } from "@/components/platform/tabla-seguridad";
import { FiltrosSeguridad } from "@/components/platform/filtros-seguridad";
import { CerrarSesiones } from "@/components/platform/cerrar-sesiones";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AccesosPage({ searchParams }: { searchParams: Promise<ParametrosPagina> }) {
  let actor: { userId: string };
  try { actor = await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const parametros = await searchParams;
  const campo = (k: string) => parametros[k] === "" ? undefined : parametros[k];
  const filtroSesiones = sesionesSchema.safeParse({ organizationId: campo("organizationId"), userId: campo("userId") });
  const filtroAccesos = eventosAccesoSchema.safeParse({ organizationId: campo("organizationId"), kind: campo("kind") });
  const { periodo, error } = periodoInforme(parametros);
  const [alertas, negocios, sesiones, eventos] = await Promise.all([
    alertasDeAcceso(), listarNegocios(), filtroSesiones.success ? listarSesiones(filtroSesiones.data) : [],
    !error && filtroAccesos.success ? eventosDeAcceso({ ...periodo, ...filtroAccesos.data }) : [],
  ]);
  // El cierre masivo es por usuario, no por el negocio activo de cada sesión.
  const ids = new Set(sesiones.map((s) => s.userId));
  const organizationId = filtroSesiones.success ? filtroSesiones.data.organizationId : undefined;
  const miembros = organizationId ? await listarUsuarios({ organizationId }) : [];
  for (const m of miembros) ids.add(m.id);
  const conteos = new Map(await Promise.all([...ids].map(async (userId) => {
    const propias = await listarSesiones({ userId });
    return [userId, { n: userId === actor.userId ? 0 : propias.length, limitado: propias.length === 200 }] as const;
  })));
  const nNegocio = [...new Set(miembros.map((m) => m.id))].reduce((n, id) => n + (conteos.get(id)?.n ?? 0), 0);
  const parcialNegocio = miembros.length === 200 || miembros.some((m) => conteos.get(m.id)?.limitado);
  const alcance = " Se cierran también las sesiones vencidas registradas. Tus propias sesiones se conservan en los cierres masivos. El total puede cambiar antes de confirmar.";
  return <>
    <h1 className="text-2xl font-semibold">Accesos</h1>
    <nav aria-label="Secciones de accesos" className="flex flex-wrap gap-4 text-sm text-primary underline"><a href="#alertas">Alertas</a><a href="#sesiones">Sesiones activas</a><a href="#inicios">Inicios de sesión</a><Link href="/platform/auditoria">Ver auditoría</Link></nav>
    <section id="alertas" className="scroll-mt-4 space-y-4 rounded-xl border border-warning-soft bg-warning-tint p-4 text-warning-text">
      <h2 className="text-xl font-semibold">Alertas</h2><p className="text-sm">Últimas 24 h · Toda la plataforma · Desde 5 fallos por IP o correo</p>
      {!alertas.porIp.length && !alertas.porCorreo.length ? <p>Sin intentos sospechosos en las últimas 24 h</p> : <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2 text-foreground"><h3 className="font-semibold">IPs con muchos intentos fallidos</h3><TablaSeguridad titulo="IPs con muchos intentos fallidos" columnas={["IP", "Fallos", "Correos atacados"]}>{alertas.porIp.map((a) => <tr key={a.ip}><td>{a.ip}</td><td>{a.fallos}</td><td>{a.correos.join(", ") || "Sin registro"}</td></tr>)}{!alertas.porIp.length && <tr><td colSpan={3}>Sin IPs sospechosas.</td></tr>}</TablaSeguridad></div>
        <div className="min-w-0 space-y-2 text-foreground"><h3 className="font-semibold">Correos atacados</h3><TablaSeguridad titulo="Correos atacados" columnas={["Correo", "Fallos", "IPs"]}>{alertas.porCorreo.map((a) => <tr key={a.email}><td>{a.email}</td><td>{a.fallos}</td><td>{a.ips.join(", ") || "Sin registro"}</td></tr>)}{!alertas.porCorreo.length && <tr><td colSpan={3}>Sin correos atacados.</td></tr>}</TablaSeguridad></div>
      </div>}
    </section>
    <section id="sesiones" className="scroll-mt-4 space-y-4">
      <h2 className="text-xl font-semibold">Sesiones activas</h2>
      <FiltrosSeguridad key={`sesiones-${JSON.stringify(parametros)}`} parametros={parametros} negocios={negocios} tipo="sesiones" />
      {!filtroSesiones.success ? <p role="alert" className="text-destructive">Los filtros de sesiones no son válidos.</p> : <>
        <p className="text-sm text-muted-foreground">Hasta 200 sesiones activas. El negocio es el activo en la sesión; un cierre de negocio abarca todas las sesiones de sus miembros.</p>
        {organizationId && <CerrarSesiones accion={{ action: "revoke_org", organizationId }} etiqueta="Cerrar todas las del negocio" descripcion={`Se cerrarán todas las sesiones de los miembros del negocio. ${parcialNegocio ? "Al menos " : ""}${nNegocio} sesiones activas afectadas.${alcance}`} />}
        <TablaSeguridad titulo="Sesiones activas" columnas={["Usuario", "Negocio", "IP", "Navegador", "Creada", "Vence", "Acciones"]}>
          {sesiones.map((s) => <tr key={s.id}><td><span className="block font-medium">{s.userName}</span><span className="break-all text-muted-foreground">{s.email}</span></td><td>{s.organizationName ?? "Sin negocio activo"}</td><td>{s.ip ?? "Sin registro"}</td><td>{navegadorLegible(s.userAgent)}</td><td>{formatoFecha(s.createdAt)}</td><td>{formatoFecha(s.expiresAt)}</td><td><div className="min-w-48 space-y-2">
            <CerrarSesiones accion={{ action: "revoke", sessionId: s.id }} etiqueta="Cerrar" descripcion={`Se cerrará 1 sesión de ${s.userName}, creada el ${formatoFecha(s.createdAt)}.${s.userId === actor.userId ? " Puedes perder el acceso a este portal." : ""}`} />
            <CerrarSesiones accion={{ action: "revoke_user", userId: s.userId }} etiqueta="Cerrar todas las de este usuario" descripcion={`Se cerrarán todas las sesiones de ${s.userName}. ${conteos.get(s.userId)?.limitado ? "Al menos " : ""}${conteos.get(s.userId)?.n ?? 0} sesiones activas afectadas.${alcance}`} />
          </div></td></tr>)}
          {!sesiones.length && <tr><td colSpan={7}>Sin sesiones activas para estos filtros.</td></tr>}
        </TablaSeguridad>
      </>}
    </section>
    <section id="inicios" className="scroll-mt-4 space-y-4">
      <h2 className="text-xl font-semibold">Inicios de sesión</h2><PeriodoInforme periodo={periodo} error={error} />
      <FiltrosSeguridad key={`accesos-${JSON.stringify(parametros)}`} parametros={parametros} negocios={negocios} tipo="accesos" />
      {!filtroAccesos.success && <p role="alert" className="text-destructive">Los filtros de inicios de sesión no son válidos.</p>}
      {!error && filtroAccesos.success && <><p className="text-xs text-muted-foreground">Hasta 200 eventos, del más reciente al más antiguo. Acota el periodo para consultar más.</p><TablaSeguridad titulo="Inicios de sesión" columnas={["Fecha", "Usuario o correo", "Negocio", "Resultado", "IP"]}>
        {eventos.map((e) => <tr key={e.id}><td>{formatoFecha(e.createdAt)}</td><td>{e.userName ?? e.email ?? "Sin registro"}</td><td>{e.organizationName ?? "Sin negocio"}</td><td><Badge variant={e.kind === "success" ? "success" : "warning"}>{etiquetaResultadoAcceso(e.kind, e.reason)}</Badge></td><td>{e.ip ?? "Sin registro"}</td></tr>)}
        {!eventos.length && <tr><td colSpan={5}>Sin inicios de sesión para estos filtros.</td></tr>}
      </TablaSeguridad></>}
    </section>
  </>;
}
