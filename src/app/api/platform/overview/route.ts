import { withSuperadmin } from "@/server/platform/guard";
import { informeSinCache, responderInforme } from "@/server/platform/informes-http";
import { resumenPlataforma } from "@/server/platform/resumen";

export const GET = informeSinCache(withSuperadmin(async (_session, req: Request) =>
  responderInforme(req, async ({ periodo }) => Response.json(await resumenPlataforma(periodo)))));
