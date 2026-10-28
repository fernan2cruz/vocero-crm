import { parseAppIconParams } from "@/lib/pwa";
import { appIconResponse } from "@/server/app-icon";
import { plataformaEnabled } from "@/server/platform/flag";

export const dynamic = "force-dynamic";

/**
 * 048 — El icono PNG de la app instalada (`?size=180|192|512`,
 * `&purpose=maskable`, `&v=` de caché). **Ruta pública**, como el favicon: el
 * navegador lo pide sin sesión para instalar la app.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = parseAppIconParams(url.searchParams);
  if (!params) {
    return Response.json(
      { error: { code: "invalid_size", message: "size debe ser 180, 192 o 512 y purpose any o maskable" } },
      { status: 400 }
    );
  }
  const imagen = await appIconResponse(params.size, params.purpose);
  const headers = new Headers(imagen.headers);
  headers.set("x-content-type-options", "nosniff");
  // Con `?v=` la URL cambia con la marca: se puede cachear fuerte.
  headers.set(
    "cache-control",
    plataformaEnabled() ? "private, no-store" : url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=60"
  );
  return new Response(imagen.body, { status: 200, headers });
}
