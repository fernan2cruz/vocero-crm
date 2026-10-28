import { withSuperadmin } from "@/server/platform/guard";
import { mutarConfig } from "@/server/platform/config/http";

type Params = { params: Promise<{ clave: string }> };
export const PUT = withSuperadmin(async (session, req: Request, { params }: Params) =>
  mutarConfig(req, (await params).clave, session.userId));
export const DELETE = withSuperadmin(async (session, req: Request, { params }: Params) =>
  mutarConfig(req, (await params).clave, session.userId, true));
