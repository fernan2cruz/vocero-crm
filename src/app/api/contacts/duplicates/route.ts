import { withAuth } from "@/lib/api";
import { buscarDuplicados } from "@/server/contact-merge";

export const dynamic = "force-dynamic";

/** Grupos de contactos que parecen la misma persona, del mismo canal. */
export const GET = withAuth(async (session) => {
  return Response.json({ groups: await buscarDuplicados(session.organizationId) });
});
