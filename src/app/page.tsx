import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { guideFirst } from "@/server/onboarding/guide";
import { plataformaEnabled } from "@/server/platform/flag";
import { getPlatformSession } from "@/server/platform/guard";
import { esSuperadmin } from "@/server/platform/admins";

export const dynamic = "force-dynamic";

/**
 * La raíz decide a dónde se entra (issue #86): mientras falte un paso de la
 * guía de inicio o el agente siga apagado, a `/onboarding`; con todo listo,
 * a la Bandeja como siempre. Sin sesión, `/inbox` manda al login.
 */
export default async function Home() {
  const session = await getSessionOrNull();
  if (!session && plataformaEnabled()) {
    const plataforma = await getPlatformSession();
    if (plataforma && await esSuperadmin(plataforma.userId)) redirect("/platform/negocios");
  }
  if (session && (await guideFirst(session))) redirect("/onboarding");
  redirect("/inbox");
}
