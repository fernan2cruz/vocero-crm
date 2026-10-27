import { notFound, redirect } from "next/navigation";
import { requireSuperadmin, PlataformaNoEncontrada } from "@/server/platform/guard";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  try { await requireSuperadmin(); }
  catch (e) { if (e instanceof PlataformaNoEncontrada) notFound(); throw e; }
  redirect("/platform/negocios");
}
