import { Badge } from "@/components/ui/badge";
import { etiquetaEstado } from "@/lib/platform-ui";

export function InsigniaEstado({ estado }: { estado: "active" | "suspended" | "disabled" }) {
  return <Badge variant={estado === "active" ? "success" : "warning"}>{etiquetaEstado(estado)}</Badge>;
}
