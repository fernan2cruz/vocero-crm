import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accionesPlataforma, type ParametrosPagina } from "@/lib/platform-ui";

/** GET conserva periodo y filtros de la otra sección; siempre reinicia el cursor. */
export function FiltrosSeguridad({ parametros, negocios, tipo }: { parametros: ParametrosPagina; negocios: { id: string; name: string }[]; tipo: "sesiones" | "accesos" | "auditoria" }) {
  const campos = tipo === "sesiones" ? ["organizationId", "userId"] : tipo === "accesos" ? ["organizationId", "kind"] : ["organizationId", "accion", "actorUserId"];
  const valor = (clave: string) => typeof parametros[clave] === "string" ? parametros[clave] : "";
  const estilo = "block h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-card px-3 text-sm";
  return <form aria-label={`Filtros de ${tipo}`} className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
    {["from", "to", "days", "userId", "kind"].filter((k) => !campos.includes(k)).map((k) => valor(k) && <input key={k} type="hidden" name={k} value={valor(k)} />)}
    <label className="min-w-0 space-y-1 text-sm sm:max-w-72"><span>Negocio</span><select name="organizationId" defaultValue={valor("organizationId")} className={estilo}><option value="">Todos los negocios</option>{negocios.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
    {tipo === "sesiones" && <label className="min-w-0 space-y-1 text-sm"><span>Usuario (ID)</span><Input name="userId" defaultValue={valor("userId")} maxLength={200} /></label>}
    {tipo === "accesos" && <label className="min-w-0 space-y-1 text-sm"><span>Tipo de inicio</span><select name="kind" defaultValue={valor("kind")} className={estilo}><option value="">Todos</option><option value="success">Correctos</option><option value="failure">Fallidos</option></select></label>}
    {tipo === "auditoria" && <>
      <label className="min-w-0 space-y-1 text-sm"><span>Acción</span><Input name="accion" list="acciones-auditoria" defaultValue={valor("accion")} maxLength={200} /><datalist id="acciones-auditoria">{Object.entries(accionesPlataforma).map(([a, nombre]) => <option key={a} value={a}>{nombre}</option>)}</datalist></label>
      <label className="min-w-0 space-y-1 text-sm"><span>Actor (ID)</span><Input name="actorUserId" defaultValue={valor("actorUserId")} maxLength={200} /></label>
    </>}
    <Button type="submit">Aplicar filtros</Button>
  </form>;
}
