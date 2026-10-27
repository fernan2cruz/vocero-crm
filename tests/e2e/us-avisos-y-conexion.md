# Guion E2E — Avisos del sistema y «sin conexión» (056)

> Automatizado en `scripts/e2e-avisos-y-conexion.mjs` (24 checks; `TEMA=dark`
> para la pasada en oscuro). Spec:
> [056](../../specs/056-avisos-y-sin-conexion/spec.md).

## Por qué

Con Wassapi atrás, el operador no se enteraba de un mensaje. Cuando se caía el
tiempo real, la bandeja se quedaba quieta sin decir nada.

## Cómo se simula

- **Los avisos:** la API `Notification` y el `showNotification` del service
  worker se reemplazan en la página y anotan cada aviso en `window.__avisos`.
- **«Wassapi oculto»:** se controla con `window.__oculta`, que cambia
  `visibilityState` y `hasFocus`.
- **La red:** se corta de verdad con `setOffline`.
- **El servidor caído:** `/api/events` responde 503 y el flujo abierto se
  cierra.

## Camino verificado

1. **AC1.** Con el permiso sin decidir, el menú ofrece «Activar avisos»; al
   concederlo, desaparece. Con el permiso negado, no aparece.
2. **AC2.** Con Wassapi oculto, un mensaje del cliente avisa: el nombre del
   contacto, el texto, el `tag` de su conversación y la URL que la abre. Un
   audio dice «Audio».
3. **AC3.** Con Wassapi al frente y con el foco no hay aviso, y con la campana
   silenciada tampoco.
4. **AC4.** `/inbox?conversation=<id>` abre esa conversación.
   - Otro aviso, con la Bandeja ya abierta, cambia a la suya.
   - El siguiente refresco de la lista no la hace saltar de vuelta.
5. **AC5.** Al cortar la red, la banda dice «Sin internet». Al volver, la
   banda se va y aparece lo que llegó mientras tanto, sin recargar.
6. **AC6.** Con `/api/events` en 503, a los 4 s la banda dice «Sin conexión
   en tiempo real». A 390 px no desborda. Al volver el servidor, «Reintentar
   ahora» la quita y la bandeja se pone al día.
