# Revisión de S8 y verificación en vivo — 2026-10-28

Carril exento: revisión, correcciones y herramientas de verificación; no se
añaden tablas ni se cambia la forma de un contrato público. Rama revisada:
`feat/066-marca-wassapi`, desde `3a3b06a`, con las correcciones de esta revisión.

## Resultado y alcance

Se revisaron el registro tipado, caché y refresco, migración 0033, cifrado,
procedencia y rotación del token, autenticación del portal, auditoría,
consumidores de la configuración y formulario. Se ejecutó el guion
`tests/e2e/us-configuracion-plataforma.md` con PostgreSQL 16 en un contenedor
descartable, procesos reales de Next **en producción** y Chrome.

La prueba encontró dos defectos funcionales que los unitarios originales no
detectaban. Ambos se corrigieron y se reprodujeron sus escenarios en el arnés.
Resultado del arnés: **64 comprobaciones aprobadas**.
Esto cierra la verificación local de S8; no equivale a aprobar el despliegue
público de toda la plataforma ni a auditar todos los cambios de 064–066.

Validación técnica del cambio: instalación con lockfile congelado, typecheck,
lint y build aprobados. Las configuraciones `default` y `completo` (todos los
canales y Agenda) pasan. La suite tiene 1941 pruebas; las seis del despliegue
se ejecutan con el `sh` de Git disponible en PATH, evitando omitirlas en Windows.
No se construyó aquí la imagen standalone de Linux: el build local de Windows
usa la excepción ya existente en `next.config.ts` y el workflow de imagen debe
verificar esa parte del PR.

## Hallazgos corregidos

### P1 — El calentamiento podía quedar fuera de la caché de las rutas

`src/server/platform/config/cache.ts` y `service.ts` guardaban los valores y
la promesa de refresco en variables del módulo. Next puede evaluar módulos
por separado en los bundles de `instrumentation` y de los handlers. Por eso
calentar al arrancar no garantizaba que el primer webhook viera el token.

Reproducción: vaciar solo la fila del verify token, arrancar dos procesos y
hacer el handshake directamente, antes de abrir el catálogo. La fila existía,
pero el handshake fallaba. Abrir antes el catálogo ocultaba el defecto porque
esa ruta volvía a calentar la configuración.

Corrección: estado compartido en `globalThis` **por proceso**, incluida la
promesa del refresco. Se conservan las revisiones que descartan lecturas
anteriores a una invalidación, la caché de 30 segundos y la degradación al
entorno. Procesos distintos siguen compartiendo únicamente PostgreSQL.

Verificación: regresión con dos evaluaciones del módulo en Vitest; carrera
real con dos procesos, fila ausente y handshake directo en ambos. La prueba
unitaria de dos importaciones ahora comprueba un solo refresco compartido;
la carrera entre procesos se prueba en PostgreSQL.

### P2 — Health informaba banderas distintas de las que usaban las rutas

`src/server/health.ts` leía directamente `process.env`. Al activar Agenda o
Atribución desde el portal, las rutas usaban la configuración de BD y health
seguía informando el respaldo del entorno.

Corrección: la lectura de runtime pasa por `configSync`, igual que las rutas.
El parámetro explícito de `healthFeatures(env)` conserva su utilidad como
parser puro. La forma de `/api/health` no cambia.

Verificación: regresión con valores de BD opuestos al entorno; en vivo se
enciende Agenda/Atribución sin reiniciar, se observa health y se consulta
la API de citas como miembro.

## Cobertura del guion

| Paso | Evidencia local |
|---|---|
| 1 | Migrador real hasta 0032, fila de límites con dato testigo, migración hasta 0033, journal completo y segunda aplicación idempotente. Solo aparece la tabla nueva. |
| 2 | Entorno sin secretos de Meta; token autogenerado, handshake 200 y entrega 503 hasta guardar App secret. El catálogo solo muestra metadatos. |
| 3 | Reinicio con el mismo token; eliminación exclusiva de su fila y dos arranques concurrentes. Ambos handshakes usan el ganador de la PK. |
| 4 | Secretos cifrados en SQL, `value_plain IS NULL`, catálogo y auditoría sin el valor; formulario vacío `password/new-password`. |
| 5 | WhatsApp, Instagram y Messenger: firma válida 200; incorrecta o ausente 401. Son entregas vacías de prueba, no una auditoría del enrutamiento entre negocios. |
| 6 | BD prevalece sobre un entorno diferente; DELETE vuelve al entorno; sin respaldo rota el token y el anterior da 404. Cancelar Quitar conserva el valor. |
| 7 | Registro abierto/cerrado, módulos, retención y versión cambian sin reiniciar. Otro proceso refresca tras el TTL. Los adaptadores reales de Graph, Instagram y Zernio hablan con un mock HTTP local usando las bases/versión guardadas. |
| 8 | Valores negativos, booleano textual, canal desconocido, versión inválida y URL con credenciales: 422 sin repetir el dato. Llave raíz fuera del catálogo: 404. |
| 9 | Miembro: página/API 404 y webhook de ajustes solo `{gestionado:true}`; sin sesión, API 401. |
| 10 | Proxy TCP inicialmente cerrado: calentamiento con texto fijo, sin datos del driver; Next arranca, sin token da 404 y con token del entorno pero sin App secret da 503. Reconectar el proxy permite refrescar el proceso aislado sin reiniciarlo. |
| 11 | Portal/API apagados 404; health conserva las banderas de entorno. El proxy SQL comprueba que el proceso y sus workers no consultan `platform_config` con `PLATAFORMA` apagada. También existe el guardarraíl unitario de cero lecturas/escrituras. |
| 12 | Chrome: formularios, error con `role=alert`, guardar, Escape/foco, cancelar y portapapeles real. Capturas a 375 y 1440 px, claro/oscuro; sin desborde ni excepciones JS. |

Las capturas son locales en `output/playwright/s8-*.png`, ignoradas por Git.
Usan solo datos y secretos ficticios de una base descartable. Las animaciones
se finalizan al capturar para evitar fotografiar la transición entre temas.

## Reproducir

Usar Node compatible y **pnpm 11.5.0**, fijado en `package.json`. El pnpm global
de esta máquina era 8.15.4: `npx --yes pnpm@11.5.0` permite usar la versión
correcta sin modificar la instalación global. La instalación congelada pasó.

1. Crear una base local **vacía**, cuyo nombre termine en `_s8`. No reutilizar
   la base del piloto ni de desarrollo. El arnés rechaza hosts remotos y bases
   con tablas. Puertos libres: 3310–3312; Chrome instalado.
2. Guardar un `.env.s8` ignorado con `DATABASE_URL`, `APP_BASE_URL=http://localhost:3310`,
   `BETTER_AUTH_SECRET` aleatorio, `ENCRYPTION_KEY` de 32 bytes en base64,
   `PLATAFORMA=on` y `MEDIA_DIR=./.dev-media/s8`. Omitir credenciales reales de
   proveedores; el arnés elimina los respaldos Meta de los procesos de prueba.
3. Ejecutar `pnpm build` y después
   `node --env-file=.env.s8 scripts/e2e-configuracion-plataforma.mjs`.
4. El arnés cierra sus procesos/proxies y conserva la base para inspección.
   Opcionalmente `S8_CONSERVAR=1` deja el servidor en 3310 hasta Ctrl+C. El
   resumen queda en `.tmp/s8/resultado.json`. Eliminar después el contenedor
   descartable y su entorno local de prueba.

El mock de transportes es exclusivamente local; no se envía ningún mensaje a
cuentas reales. El script no importa `@playwright/test` ni cambia las dependencias.

## Estado actualizado de los demás pendientes

- **Purga de accesos: implementada.** `iniciarPurgaAccesos()` se llama desde
  `resumeWebhooks()`: primera pasada al arrancar y luego cada 24 horas, con
  lotes de 1000. La retención se consulta en la configuración. No confundirlo
  con 2FA, reautenticación, sesión corta o lista de IPs: eso sigue pendiente.
- **Campañas: el reclamo inicial ya está en PostgreSQL.** En `campaigns.ts`
  solo gana quien cambia atómicamente `draft → sending`; cada destinatario
  también reclama `pending → sending`. `enCurso` queda como optimización
  local. Sigue faltando recuperación con lease tras caídas; los destinatarios
  abandonados en `sending` no se reintentan automáticamente. El informe
  anterior confundía este pendiente con ausencia total de reclamo en BD.
- **Límites:** siguen siendo comprobaciones previas, sin reserva atómica de
  cupo. No se promete un límite estricto bajo concurrencia.
- **Laboratorio y Nea:** siguen las limitaciones de clasificación del gasto
  y de idempotencia de diferidos documentadas en 065. Esta revisión no ejecutó
  la suite Python de la copia local de Nea ni cambió ese código.
- **Canales sociales:** las firmas probadas aquí no acreditan aislamiento
  multi-negocio. Falta verificar lotes con varias cuentas, reentregas y
  suspensión, especialmente porque `resolverOrganizacion` asigna el evento
  guardado a la primera cuenta reconocida y el procesador recorre su payload.
- **Permisos y opcionales:** continúan los tres roles fijos. Catálogo, planes,
  anuncios, «ver como» y banderas por negocio requieren su diseño pendiente.
- **Nea local:** decisión de empaquetado: mantener el cerebro en repositorio
  propio y excluir `/nea-agent/` del CRM. No se elimina ni publica la copia
  local. El despliegue multi-negocio requiere publicar/fijar la imagen del
  fork con sus cambios; la imagen oficial configurada por defecto no basta
  (ver comentarios en `deploy/docker-compose.prod.yml`).
- **AlmaLinux:** no se dispone en esta tarea del servidor de destino. La
  validación local no acredita TLS, SELinux, respaldos o recuperación allí.
- **Gobernanza:** 065 documenta la petición de plataforma multi-negocio, pero
  la constitución 1.4.0 aún limita el producto a un negocio y excluye funciones
  solo de plataforma (VIII). Falta registrar la enmienda correspondiente; esta
  revisión no cambia silenciosamente la constitución.

La evaluación del catálogo de productos se encuentra en
[`evaluacion-productos.md`](evaluacion-productos.md). Los puntos anteriores
deben mantenerse visibles en el PR; no se presentan como corregidos por S8.
