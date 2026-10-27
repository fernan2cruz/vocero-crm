import { TeamClient } from "@/components/settings/team-client";
import { plataformaEnabled } from "@/server/platform/flag";

export const dynamic = "force-dynamic";

export default function TeamSettingsPage() {
  return <TeamClient gestionado={plataformaEnabled()} />;
}
