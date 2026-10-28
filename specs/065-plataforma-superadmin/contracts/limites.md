# S7 — Límites por negocio

La bandera `PLATAFORMA` precede a toda lectura de límites y de uso. Apagada,
las rutas responden 404 y las guardas no consultan la base. Solo el superadmin
puede leer o modificar límites. Los negocios reciben únicamente errores de envío
o de IA, sin una API nueva de administración.

## Gestión

`GET /api/platform/tenants/{id}/limits` devuelve:

```json
{
  "limites": {
    "maxMessagesPerDay": 500,
    "maxCampaignRecipients": null,
    "maxMonthlySpendMicros": 10000000
  },
  "uso": { "mensajesHoy": 120, "gastoMesMicros": 2000000 }
}
```

`PUT` en la misma ruta exige los tres campos de `limites`, enteros positivos o
`null`, sin claves adicionales. Los campos integer admiten hasta 2147483647;
micro-USD admite hasta `Number.MAX_SAFE_INTEGER`. Responde 200 con `{ limites }`,
422 ante un cuerpo inválido, 404 sin negocio o sin acceso de superadmin y 401
sin sesión. No tener fila equivale a los tres valores `null`.

`organization_limits` tiene PK/FK `organization_id`, borrado en cascada, los tres
topes opcionales con CHECK positivo y `updated_at timestamptz`. El guardado
bloquea la organización, hace upsert y audita `limits.set` con `antes` y
`despues`, todo dentro de la misma transacción. No necesita un id adicional.

## Guardas

- Diario: se cuentan salientes no fallidos de conversaciones fuera del
  Laboratorio, con los dos lados del join restringidos al negocio. El día se
  resuelve con `businessTimezone` y `resolvePeriod`, desde medianoche local hasta
  el inicio del día siguiente. Con uso >= tope se rechaza antes de Meta con
  `SendError`, código `limite_diario`; todas las rutas de envío responden 429.
  Texto, media y estructurados comparten `prepareSend`; las plantillas reutilizan
  la misma guarda. Las campañas vuelven a borrador y conservan pendientes, con
  motivo `limite_diario`, sin marcar al destinatario como fallido.
- Campaña: se verifica la cantidad resuelta al crear y el total congelado al
  enviar. Cantidad > tope devuelve 422 `limite_destinatarios`. El máximo global
  existente de 500 sigue aplicando.
- Mensual: suma de `ai_usage.cost_micros` del mes calendario UTC, con organización
  explícita. Solo se consulta para modo `platform`. Uso >= tope produce estado
  `tope_mensual`, 402 en el proxy y el aviso «Se alcanzó el tope mensual de IA de
  este negocio». No se lee ni devuelve la llave de plataforma al bloquear.

Un error de lectura en las guardas deja pasar y registra un mensaje fijo con
`console.error`, sin el error ni otros datos. Los errores de gestión no se
ocultan. Los conteos son comprobaciones previas, sin reserva de cupo: envíos o
llamadas de IA simultáneos pueden rebasar el tope antes de persistir su consumo.

## El Laboratorio y el tope mensual (resuelto)

El brief pedía que el Laboratorio jamás contara ni se bloqueara. `ai_usage` tiene fuentes `bot`, `lab` y `judge`,
y el proxy del cerebro no identifica la conversación. Decisión:

- **El gasto del tope cuenta solo `source = 'bot'`** (el agente real). Lo que gasta el Laboratorio y el juez no
  cuenta: un negocio que prueba mucho no se queda sin agente.
- **El tope se aplica solo donde se pide**: `resolveAiProvider(org, { aplicarTope: true })`, que usan el proxy
  `/api/bot/llm` y `/api/bot/profile`. El Laboratorio y el juez llaman sin ese parámetro y nunca se bloquean.
- Lo que sí se bloquea: el agente de producción (402 `tope_mensual`, silencio + handoff del lado del cerebro).

## Verificación

Pruebas unitarias: `platform-limites`, `platform-limites-envio`,
`platform-limites-rutas`, `campaign`, `platform-resolucion-ia` y `platform-ui`.
La prueba con PostgreSQL y navegador sigue el guion
`tests/e2e/us-limites-negocio.md` y corresponde a la revisión acordada.
