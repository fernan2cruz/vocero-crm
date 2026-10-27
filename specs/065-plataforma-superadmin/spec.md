# 065 — Plataforma: portal de superadmin

**Feature Branch**: `feat/065-plataforma-superadmin`

**Created**: 2026-10-27

**Status**: Especificada. Rebanada S1 en curso (primer trabajo delegado a Codex).

**Input**: El dueño, el 2026-10-27: «el superadmin … tendrá un portal que pueda
gestionar a todos los usuarios, los agentes de AI, el crédito, y
visualizaciones de consumo y productividad de su tenant, y funcionalidades que
me puedas recomendar».

**Carril**: completo. Toca autenticación, aislamiento de tenants, dinero
(crédito) y el camino de la IA.

## El problema

Hoy una instancia es un negocio: el registro se cierra tras la primera
organización (`server/auth/registration.ts`), cada negocio pega su propia llave
de IA y nadie ve a nadie. El aislamiento por `organization_id` ya existe en
cada tabla, pero no hay nadie por encima de las organizaciones: ni quien las
cree, ni quien vea cuánto gastan, ni quien pause un agente que se desbocó.

## Decisiones ya tomadas (2026-10-27)

- **D1 — Vive en este repo, tras la bandera `PLATAFORMA`** (ADR-001). Apagada
  por defecto: quien instala un solo negocio no ve nada nuevo y todas las
  superficies responden 404. La migración se aplica siempre.
- **D2 — Crédito = cupo interno de IA con llave de plataforma.** El superadmin
  asigna a cada negocio un saldo de uso de IA; la IA corre con la llave de la
  plataforma y se descuenta por consumo; al agotarse el agente se pausa. NO hay
  cobro ni pasarela de pago: la soberanía del núcleo (constitución II) lo
  prohíbe. Un negocio puede seguir en modo «llave propia» y entonces solo se
  mide.
- **D3 — Superadmin es una marca en la base** (`platform_admin`), no una
  variable de entorno. Eso exige cerrar la escalada de privilegios (ver
  Seguridad).

## Seguridad (lo que no se negocia)

- **S-1 · Una sola puerta.** Todo handler de plataforma pasa por
  `requireSuperadmin()`: 404 si la bandera está apagada, 401 sin sesión, 404
  (no 403) a quien no es superadmin — la superficie no existe para los demás.
  Una prueba escanea `src/app/api/platform/**` y `src/app/(platform)/**` y
  falla si algún handler no la usa.
- **S-2 · Bootstrap sin portal.** El primer superadmin se otorga por consola
  (`pnpm platform:grant <correo>`), nunca por una pantalla pública. Los demás
  los otorga un superadmin desde el portal, con confirmación y auditoría.
- **S-3 · Nunca el último.** No se puede quitar el último superadmin ni
  quitarse a uno mismo si es el único.
- **S-4 · Auditoría append-only.** Toda acción de plataforma (crear, suspender,
  ajustar crédito, otorgar superadmin, cambiar llave) escribe en
  `platform_audit`: quién, qué, a quién, cuándo y el detalle. Nada se edita ni
  se borra.
- **S-5 · Sin ver secretos.** El portal jamás muestra ni devuelve llaves,
  tokens ni mensajes de clientes: solo agregados y metadatos. La llave de
  plataforma se guarda cifrada (AES-256-GCM, `lib/crypto`) y solo muestra los
  últimos 4.
- **S-6 · Aislamiento intacto.** El portal lee entre organizaciones SOLO a
  través de `server/platform/*`, que recibe el id de la organización como
  parámetro explícito. Ningún camino de la app normal (`withAuth`) gana
  alcance entre tenants.
- **S-7 · Suspender corta de verdad.** Un negocio suspendido no puede iniciar
  sesión, no despacha al cerebro, no envía campañas y su webhook sigue
  recibiendo (y guardando) para no perder mensajes.

## Modelo de datos (todas aditivas; `organization` y `user` de Better Auth NO se tocan)

- `platform_admin(user_id PK → user, granted_by, created_at)`.
- `organization_platform(organization_id PK → organization, status
  active|suspended, ai_mode own_key|platform, suspended_at,
  suspended_reason, notes, created_at)`. Ausencia de fila = activa y
  `own_key`: las instancias existentes no cambian.
- `platform_settings(id=1, ai_provider, ai_base_url, ai_model, token_cipher,
  token_iv, token_tag, token_last4, updated_at)`: la llave de plataforma.
- `ai_credit_account(organization_id PK, balance_micros bigint)` y
  `ai_credit_ledger(id, organization_id, kind grant|usage|adjust|refund,
  amount_micros signed, balance_after, ref, note, actor_user_id, created_at)`,
  append-only. Dinero en **micro-dólares enteros**; jamás flotantes.
- `ai_usage(id, organization_id, source bot|lab|judge, model, prompt_tokens,
  completion_tokens, cost_micros, created_at)`. El costo sale de lo que el
  proveedor reporte; si no lo reporta, de `ai_model_price` (tokens × precio
  por millón), editable en el portal.
- `platform_audit(id, actor_user_id, action, organization_id, target_user_id,
  detail jsonb, created_at)`.

## Comportamiento

- **PL-1 · Negocios.** Lista con estado, usuarios, saldo y consumo del mes;
  crear un negocio (nombre + propietario con contraseña temporal, reusando
  `runInternalSignup` y la siembra de `on-signup.ts`); suspender y reactivar
  con motivo.
- **PL-2 · Usuarios.** Todos los usuarios con su negocio y rol; desactivar y
  reactivar; forzar contraseña temporal. SIN suplantar sesiones.
- **PL-3 · Agentes de IA.** Por negocio: agente encendido o no, cerebro sano o
  no, modo de IA (llave propia/plataforma), modelo; apagarlo desde el portal
  (el «botón rojo») con motivo auditado.
- **PL-4 · Crédito.** Saldo por negocio; recargar o ajustar con nota
  obligatoria; libro con cada movimiento; alertas al 20 % y al 0 %. Con modo
  `platform` y saldo ≤ 0, la IA responde `paused_no_credit` (estado que la
  tubería de IA ya entiende) en vez de gastar.
- **PL-5 · Consumo.** Por negocio y por periodo (en la zona del negocio,
  `analytics/period.ts`): costo, tokens, llamadas, por fuente (agente,
  Laboratorio, juez) y por modelo; serie diaria; top de negocios.
- **PL-6 · Productividad.** Por negocio, reusando `server/analytics/*`:
  conversaciones, mensajes entrantes y salientes, % respondido por el agente,
  tiempo de primera respuesta, traspasos a humano, citas, tratos ganados y
  ventas. Comparable entre negocios.
- **PL-7 · Resumen.** Negocios activos/suspendidos, usuarios, consumo del mes,
  crédito total y los negocios en riesgo (saldo bajo, agente apagado, cerebro
  caído, webhooks agotados).

## Rebanadas (cada una se entrega verde antes de la siguiente)

- **S1 · Cimientos.** Bandera `PLATAFORMA`; migración con las tablas de
  arriba; `requireSuperadmin()` + prueba de guardarraíl (S-1); script
  `platform:grant`; helper `auditar()`; pruebas. Sin UI.
- **S2 · Negocios y usuarios (PL-1, PL-2).** API + pantallas.
- **S3 · Medición y crédito (PL-4, parte de PL-5).** Registrar `ai_usage` en
  el proxy del cerebro y en `chatJson`; libro y cuenta; llave de plataforma;
  resolución `platform` en `lib/ai/provider.ts`. **La más riesgosa:** toca el
  camino de la IA de todos.
- **S4 · Consumo, productividad y resumen (PL-5, PL-6, PL-7).**
- **S5 · Agentes y recomendaciones (PL-3 y lo de abajo).**

## Funcionalidades recomendadas (después de S5, por valor)

1. **Alertas de crédito y pausa automática**, con aviso al propietario.
2. **Límites por negocio**: mensajes por día, tope de destinatarios por
   campaña, topes de gasto diario (corta un bucle de IA desbocado).
3. **Banderas por negocio** (agenda, atribución, canales) en lugar de por
   despliegue, que es lo que un modelo multi-negocio realmente pide.
4. **Salud del negocio**: puntaje con webhooks agotados, cerebro caído,
   conversaciones sin responder, avance de la guía de inicio.
5. **Planes**: plantillas de crédito y banderas para dar de alta rápido.
6. **Anuncios** a los negocios (mantenimiento, novedades).
7. **Ver como** de solo lectura, con motivo, límite de tiempo y auditoría
   visible para el negocio (solo si el dueño lo pide; es lo más delicado).
8. **Exportar** consumo y productividad a CSV (ya existe `lib/csv.ts`).

## Cómo se trabaja (Claude piensa, Codex ejecuta)

Claude escribe el brief de cada tarea (archivos, contrato, criterios de
aceptación y qué NO tocar), Codex implementa en un worktree aparte
(`feat/065-plataforma-superadmin`), y Claude revisa el diff completo, corre
`pnpm typecheck && pnpm lint && pnpm test` y la prueba de comportamiento antes
de aceptar. Una tarea que Codex entregue sin pasar eso no está hecha.
