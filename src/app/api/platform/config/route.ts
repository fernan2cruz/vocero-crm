import { withSuperadmin } from "@/server/platform/guard";
import { listarConfig } from "@/server/platform/config/service";

export const GET = withSuperadmin(async () => Response.json(await listarConfig()));
