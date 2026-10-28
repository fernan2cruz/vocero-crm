import { asc, eq } from "drizzle-orm";
import { plataformaEnabled } from "@/server/platform/flag";
import { getSessionOrNull } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  type Branding,
} from "@/lib/branding";

/** Marca guardada en organization.metadata (JSON de Better Auth). */

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Marca + a qué organización pertenece.
 *
 * El icono se guarda como archivo en `MEDIA_DIR/{organizationId}/favicon`, así
 * que servirlo necesita el id — y la ruta que lo sirve es pública (el login
 * también tiene pestaña), donde no hay sesión de la que sacarlo.
 */
export async function getBrandingContext(
  organizationId?: string | null
): Promise<{ organizationId: string | null; branding: Branding }> {
  if (plataformaEnabled() && !organizationId) {
    return { organizationId: null, branding: DEFAULT_BRANDING };
  }
  const db = getDb();
  const rows = organizationId
    ? await db
        .select({ id: schema.organization.id, metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    : // Sin sesión (login, layout raíz): la única organización de la instancia.
      await db
        .select({ id: schema.organization.id, metadata: schema.organization.metadata })
        .from(schema.organization)
        .orderBy(asc(schema.organization.id))
        .limit(1);
  if (!rows[0]) return { organizationId: null, branding: DEFAULT_BRANDING };
  const meta = parseMetadata(rows[0].metadata);
  return {
    organizationId: rows[0].id,
    branding: normalizeBranding(
      (meta.branding as Partial<Branding> | undefined) ?? null
    ),
  };
}

/** Superficies compartidas: la sesión decide la marca; sin ella, plataforma. */
export async function getRequestBrandingContext() {
  if (!plataformaEnabled()) return getBrandingContext();
  const session = await getSessionOrNull();
  return getBrandingContext(session?.organizationId);
}

export async function getRequestBranding(): Promise<Branding> {
  return (await getRequestBrandingContext()).branding;
}

export async function getBranding(
  organizationId?: string | null
): Promise<Branding> {
  return (await getBrandingContext(organizationId)).branding;
}

export async function saveBranding(
  organizationId: string,
  branding: Branding
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.branding = normalizeBranding(branding);
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
}
