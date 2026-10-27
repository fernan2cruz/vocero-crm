# Cerebro por negocio

Cada llamada privada a `/api/bot/*`, incluido el proxy de IA, queda ligada a
un negocio. El secreto del despliegue es `BOT_API_KEY`, el mismo que firma
el despacho. No se entrega este secreto a un cerebro limitado a un negocio:
se le entrega únicamente su credencial derivada.

La derivación es:

```text
base64url_sin_relleno(HMAC-SHA256(BOT_API_KEY, "vocero:cerebro:v1:" + organizationId))
```

El cerebro envía ambas cabeceras:

```http
Authorization: Bearer <credencial derivada>
X-Vocero-Organization: <organizationId>
```

`X-API-Key: <credencial derivada>` también sirve en lugar de
`Authorization`; si se envían ambas, tiene prioridad `X-API-Key`.
La organización es el **id**, no el slug. Con esa cabecera, la llave global
sin derivar no autentica. Una credencial inválida o una organización inexistente
devuelven el mismo 401 `unauthorized` («No autorizado»).

Vectores del contrato de Python de Nea (sin relleno `=`):

| Secreto | Organización | Credencial |
|---|---|---|
| `0123456789abcdef0123456789abcdef` | `org_abc123` | `35xQLucxgNu2V_i1FU6XZE9x9gYYH7W5CaTS4HoN2NI` |
| `0123456789abcdef0123456789abcdef` | `org_xyz789` | `d5SrG-VOghQfSSRJ9qUzCgPW7Gvd1tCOR3jQ-AH1ytk` |
| `0123456789abcdef0123456789abcdef` | `org_p6tfcmmeavg8k3ya9i1d` | `xdk7Phv1vCRBgyks0GFZwhEiaEzXy0HRmCzWYrjfMBE` |
| `ffffffffffffffffffffffffffffffff` | `org_abc123` | `eWeOqUXQrS7ioBWxo0k_nLL8diEjAHZumzrFoe0foJE` |

Sin `X-Vocero-Organization` se mantiene el modo heredado: se autentica con
`BOT_API_KEY` tal cual. Con un solo negocio funciona como antes; sin negocios
devuelve 409 `no_org`; con dos o más devuelve 409 `org_ambiguous`
(«Con varios negocios, indica X-Vocero-Organization»). Se consulta en cada
llamada: un alta en runtime no deja una organización antigua cacheada.

Con `PLATAFORMA` encendida, un negocio suspendido devuelve 403
`org_suspended` («Negocio suspendido»), también en modo heredado.
La bandera apagada no aplica esa suspensión.

El presupuesto autenticado es 1200 llamadas/minuto por negocio indicado.
El modo heredado conserva su presupuesto global de 1200/minuto.
Los fallos de autenticación conservan el freno de 30/minuto por IP.
La actividad del cerebro que lee la UI se registra por negocio.

Nea con `VOCERO_MODE=cloud` usa `/api/brains/*`: es otro contrato.
Para usar `/api/bot/*` con varios negocios, Nea debe enviar las dos
cabeceras anteriores con el id de organización. Esa adaptación pertenece a
`nea-agent` y queda fuera de esta tarea. Aquí no cambia el despacho.
