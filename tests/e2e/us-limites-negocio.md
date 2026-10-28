# 065 S7 — Límites por negocio

## Preparación

Usar la app con mocks, PostgreSQL con migración 0032 aplicada, `PLATAFORMA=on`,
dos negocios A/B, una sesión de superadmin y una de propietario de A. A tiene
WhatsApp conectado al mock y una conversación real dentro de ventana.
Este guion queda para Claude, responsable de PostgreSQL y navegador en el brief.

## Gestión y aislamiento

1. Como superadmin, abrir el detalle de A a 375 px, en claro y oscuro. La tarjeta
   Límites tiene tres campos etiquetados, texto de uso y botón Guardar límites;
   no desborda horizontalmente.
2. Guardar 2 mensajes/día, 1 destinatario/campaña y 0,000100 USD de gasto mensual.
   Refrescar: conserva valores y muestra el uso actual. Vaciar los tres y guardar:
   GET devuelve null en los tres campos. Valores cero, negativos, fraccionarios
   en conteos y claves extra reciben 422 sin cambiar la fila ni auditar.
3. Verificar `limits.set` con el actor, A y antes/después. Forzar un fallo de
   auditoría dentro de una transacción de prueba: no debe quedar el cambio.
4. Con sesión de propietario, GET y PUT de límites devuelven 404. Sin sesión,
   401. B conserva sus propios límites. Con plataforma apagada ambas rutas
   devuelven 404, sin consultas de límites en envíos normales.

## Mensajes y campañas

1. Fijar el límite diario al uso actual más uno. Enviar texto por la UI: llega
   al mock. El siguiente texto recibe 429 `limite_diario`, con el mensaje del
   tope y sin llamada al mock ni fila saliente fallida.
2. Repetir el bloqueo con adjunto, ubicación/contacto, reenvío, plantilla y
   `/api/bot/messages`. Verificar el mismo 429 y que Meta no se toca.
3. Un saliente `failed` y uno de una conversación `is_test` no aumentan el uso.
   `/api/bot/messages` de prueba conserva el camino de guardado del sandbox.
4. Configurar una zona del negocio distinta de UTC e insertar mensajes a ambos
   lados de medianoche local; GET solo cuenta el día local. B no suma para A.
5. Con máximo de 1 destinatario, crear campaña con 2 devuelve 422
   `limite_destinatarios`. Crear con 2 cuando no hay límite, después fijar 1 y
   enviar también devuelve 422. No arranca el bucle.
6. Permitir 3 destinatarios y fijar el diario para que solo quepa uno más. La
   campaña manda uno, se interrumpe por `limite_diario` y vuelve a borrador;
   los otros siguen pendientes, sin fallidos. Aumentar el tope y reanudar:
   manda solo los pendientes.

## IA y degradación

1. Con A en modo platform, saldo positivo y gasto mensual por debajo del tope,
   el proxy funciona. Insertar consumo hasta el tope: estado `tope_mensual`,
   proxy 402 `tope_mensual` sin llamada al proveedor, aviso al propietario exacto
   y ningún dato de la llave global (tampoco últimos cuatro).
2. Comprobar con el cerebro de revisión que ese 402 provoca silencio y handoff.
   No se modificó el código del cerebro en esta entrega.
3. Consumo del mes anterior y de B no cuenta. Modo own_key no aplica el tope
   mensual. Campos null o ausencia de fila dejan pasar.
4. Simular error de lectura de límites/conteos con los demás datos disponibles:
   el envío sigue; el log no muestra datos ni el objeto del error.
5. Resolver antes de aceptar el caso mensual del Laboratorio la contradicción
   descrita en `specs/065-plataforma-superadmin/contracts/limites.md`.
