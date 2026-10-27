# Guion E2E — Wassapi en el celular (048)

> Automatizado en `scripts/e2e-pwa.mjs` (36 checks: API, HTML, CDP y Playwright
> con un perfil persistente de Chromium). Spec:
> [048](../../specs/048-pwa/spec.md).

## Por qué

El dueño atiende desde el celular y Wassapi vivía en una pestaña. Sin manifest
el navegador no ofrecía instalarlo, y en el iPhone «Agregar a inicio» dejaba
un recorte de la página como icono.

## Cómo se corre

Con la app viva y los mocks (`WA_MOCK_ENABLED=true`):

```bash
node --env-file=<env> scripts/e2e-pwa.mjs
```

`E2E_PWA_EMAIL` y `E2E_PWA_PASSWORD` sirven para entrar con una cuenta que ya
exista; si no se ponen, el guion crea la suya. Usa un perfil persistente
porque en incógnito Chromium nunca da una app por instalable.

## Camino verificado

1. **Manifest (AC1).** La marca se rebautiza «Taller Ruiz …» con acento verde.
   `GET /manifest.webmanifest` sin sesión → 200 `application/manifest+json` con:
   - `name` igual al de la marca y `short_name` de ≤ 12;
   - `standalone` desde `/`;
   - ningún «Wassapi»;
   - iconos 192 y 512 (`any`) y 512 (`maskable`).
2. **Iconos (AC2).** Cada uno es un PNG del tamaño exacto (se lee el IHDR).
   ✅ `size=64` → 400.
   ✅ Con un logo SVG subido, la URL del icono cambia y el dibujo es otro;
   al quitarlo vuelve el generado.
3. **iPhone (AC3).** El HTML de `/inbox` trae:
   - `apple-touch-icon` → PNG de 180×180;
   - `apple-mobile-web-app-capable=yes` y el título con el nombre corto;
   - el `<link rel="manifest">`;
   - `theme-color` `#070e20`, el azul de la barra lateral.
4. **Instalable (AC4).**
   ✅ El service worker queda activo con alcance `/`.
   ✅ `Page.getAppManifest` no da errores.
   ✅ `Page.getInstallabilityErrors` sale vacío.
5. **Botón (AC6).** Sin `beforeinstallprompt`, no hay «Instalar app». Con el
   aviso (simulado) aparece encima de Ajustes.
   ✅ Al usarlo se llama a `prompt()` una vez y la fila desaparece.
6. **Sin conexión (AC5).** Con la red cortada, navegar a `/pipeline` da
   «Sin conexión» con **Reintentar**, sin nombre de marca.
   ✅ `fetch("/api/conversations")` falla, sin respuesta inventada.
   ✅ Al volver la red, Reintentar carga la pantalla.
7. **Nada en caché (AC7).** `caches.keys()` está vacío.
8. La marca vuelve a como estaba.

## Lo que no cubre

- **El diálogo nativo de instalación**: el guion simula
  `beforeinstallprompt`. Que Chromium la da por instalable lo dice
  `getInstallabilityErrors`.
- **Safari en un iPhone de verdad**: se revisan las etiquetas que lee
  Safari, no Safari.
