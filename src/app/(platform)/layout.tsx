import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";
import { PlatformShell } from "@/components/platform/platform-shell";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  const sesion = await getAuth().api.getSession({ headers: await headers() });
  return <PlatformShell nombre={sesion?.user.name ?? "Superadmin"}>{children}</PlatformShell>;
}
