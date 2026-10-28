# Despliegue de Wassapi en un servidor piloto (AlmaLinux 9)

Mismo flujo que DomiaX y ExpenseTracker: Docker Compose endurecido, `deploy.sh` con respaldo previo y reversión
automática, respaldos diarios con prueba de restauración, y `.env` fuera del repositorio. Todo vive en `deploy/`.

```
Internet ──> Caddy (80/443, HTTPS automático) ──> app (CRM + portal de superadmin) ──> postgres (red interna)
                                                   └─> nea (agente) ───────────────┘
                                backup (diario) ──> volumen `backups`
```

## 1. Servidor

- AlmaLinux 9, mínimo 2 vCPU, 4 GB de RAM y 30 GB de disco (el build de la imagen pide ~2 GB de RAM: con 2 GB, añade swap).
- Un dominio o subdominio (`crm.tudominio.com`) con un registro **A** apuntando a la IP del servidor, y los puertos 80 y 443
  abiertos hacia internet (Let's Encrypt los necesita).

```bash
sudo dnf -y update
sudo dnf -y install git openssl dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"        # cierra sesión y vuelve a entrar
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

**SELinux**: déjalo en `enforcing`. Los montajes del compose ya llevan la etiqueta `:z`. No hace falta desactivarlo.

## 2. Primer despliegue

```bash
git clone <tu-repositorio> wassapi && cd wassapi/deploy
git checkout feat/066-marca-wassapi          # o la rama que quieras desplegar
./scripts/gen-env.sh crm.tudominio.com       # crea .env (permisos 600) con todos los secretos generados
```

Edita `deploy/.env`:

- `CADDY_GLOBAL=email admin@tudominio.com` (avisos de Let's Encrypt).
- `ALLOWED_WA_IDS=` con tu número mientras pruebas.

```bash
./scripts/deploy.sh --build v1
```

El script construye la imagen, hace un respaldo previo si ya hay stack corriendo, levanta todo y espera a que la app
responda sana. Si no queda sana, revierte a la versión anterior (en el primer despliegue no hay a qué volver y deja el
stack para inspeccionarlo con `docker compose -f docker-compose.prod.yml logs`).

> **Guarda una copia de `deploy/.env` fuera del servidor.** `ENCRYPTION_KEY` cifra los secretos que viven en la base
> (tokens de WhatsApp, llaves de IA). Un respaldo de la base sin esa llave no los recupera.

## 3. Primer superadmin

1. Abre temporalmente el registro con un override de Compose, sin añadir variables al `.env`:
   ```bash
   docker compose -f docker-compose.prod.yml -f - up -d app <<'YAML'
   services:
     app:
       environment:
         ALLOW_SIGNUP: "true"
   YAML
   ```
   Abre `https://crm.tudominio.com` y crea tu cuenta. Haz este paso antes de anunciar el servidor.
2. Otórgale superadmin:
   ```bash
   docker compose -f docker-compose.prod.yml exec app node platform-grant.mjs tu@correo.com
   ```
3. Retira el override recreando la app con su compose normal:
   `docker compose -f docker-compose.prod.yml up -d --force-recreate app`.
   Si actualizas una instalación antigua, quita también cualquier `ALLOW_SIGNUP=true` de su `.env`.
4. Entra a `https://crm.tudominio.com/platform`: negocios, usuarios, IA y crédito, consumo, accesos, auditoría.

## 4. Conectar WhatsApp

Entra como superadmin a `/platform/configuracion` y pega el **App secret de Meta**
(Meta → Configuración → Básica). Sin él, los webhooks de Meta responden 503; con él exigen firma válida.
En «Webhook de Meta», copia la URL completa y el verify token a Meta. El token se autogenera una vez y se guarda
cifrado en la base: no hay que añadirlo al `.env`. Cambiarlo o quitarlo sin respaldo genera una URL nueva;
actualiza también Meta y vuelve a registrar los números. La conexión del número se hace desde la app del negocio.
La llave y los modelos de IA de plataforma se configuran en `/platform/ia`.

### Qué queda fuera del portal y por qué

El `.env` nuevo solo necesita `DOMAIN`, `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
`BOT_API_KEY` y `PLATAFORMA=on`, además de opciones de infraestructura y Nea si se usan.
`DOMAIN` y `POSTGRES_PASSWORD` permiten a Compose derivar `APP_BASE_URL` y `DATABASE_URL` antes de abrir la base;
`ENCRYPTION_KEY` es la llave raíz que descifra los secretos de esa misma base;
`BETTER_AUTH_SECRET` firma las sesiones; `BOT_API_KEY` se comparte con el servicio Nea;
`PLATAFORMA` decide si existe el portal antes de consultar la base. Ninguna puede depender de una configuración
que solo se pueda leer después de usarla.

Los valores del portal ganan a los del `.env`. «Quitar» vuelve al respaldo o al valor predeterminado;
sin respaldo del verify token se genera otro. Los secretos no se rellenan al editar: solo se muestran sus últimos
cuatro caracteres. El verify token completo se presenta únicamente al superadmin para copiarlo a Meta.
Los cambios se aplican sin reiniciar. La caché dura 30 segundos; el proceso que guarda la invalida inmediatamente
y los demás refrescan en segundo plano al volver a usarla. Si la base falla al leer, se descarta la caché anterior
y se usan el `.env` y los valores predeterminados; se registra un mensaje fijo sin datos. El arranque continúa.
Si además falta App secret, Meta sigue recibiendo 503. Sin `PLATAFORMA`, esta capa no consulta la base.

**Actualizar desde un `.env` antiguo:** no hay que migrar sus variables a mano. `env_file` en el servicio app
conserva esos respaldos, incluidas las antiguas variables de IA. El generador nuevo ya no las escribe.
Puedes copiarlas al portal y retirarlas del archivo después de comprobar el resultado. Las opciones de mocks
siguen solo en el entorno de pruebas; nunca se configuran en el portal.

## 5. Varios negocios y el agente (Nea)

- Con la imagen oficial de Nea (`NEA_IMAGE` por defecto) la plataforma sirve **un solo negocio** con agente.
- Para varios negocios con agente, construye la Nea del fork y define en `.env`:
  `NEA_IMAGE=wassapi-nea`, `NEA_VERSION=1`, `NEA_VOCERO_MODE=cloud`, `NEA_CRM_SURFACE=bot`.
  Probado de punta a punta con dos negocios sobre este mismo stack (29 verificaciones): cada negocio contesta por
  su número y con su agente, el mismo cliente tiene una conversación por negocio, el consumo y el crédito se cargan
  a quien corresponde, una credencial no sirve con otro negocio y un negocio suspendido deja de contestar.
- `NEA_DISPATCH_WORKERS` (por defecto 4): cuántos despachos atiende Nea a la vez. Un negocio nunca ocupa más de uno
  (sus mensajes salen en orden) y los demás atienden a otros, así que la ráfaga de un cliente no deja esperando al
  resto. Con un modelo de 3 s por respuesta, un negocio en medio de una ráfaga de 12 de otro pasó de esperar 13.9 s a
  4.8 s. Súbelo si tienes muchos negocios activos a la vez.

## 6. Operación

| Qué | Cómo |
|---|---|
| Estado | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Actualizar | `git pull && ./scripts/deploy.sh --build v2` (cambia la etiqueta en cada versión) |
| Reversión manual | `./scripts/deploy.sh --rollback` (usa `.previous_tag` y la imagen local, sin construir ni descargar) |
| Respaldo ahora | `docker compose -f docker-compose.prod.yml exec -e BACKUP_DIR=/backups/postgres backup sh /scripts/backup-postgres.sh` |
| Cloudflare Tunnel | `CADDY_TLS=tls internal`, `BIND_ADDR=127.0.0.1`, `CLOUDFLARE_TUNNEL_TOKEN=…` y `--profile tunnel` |

Las migraciones corren al arrancar la app. La reversión devuelve la imagen, no el esquema de la base: toda migración
debe ser aditiva (primero se añade, después se retira lo viejo).

Si falla la construcción, se aborta antes de cambiar `.env`. Si falla la descarga, el arranque de Compose o la salud,
se restaura la etiqueta desplegada y se arranca su imagen local; el comando sale con error incluso si la reversión
funciona. Sin versión previa se conserva el intento para inspección. Cada despliegue sano guarda la etiqueta
desplazada en `.previous_tag`; `--rollback` exige ese archivo y pasa por el mismo respaldo y control de salud.

## 7. Respaldos

El servicio `backup` guarda cada día (07:00 UTC por defecto) un `pg_dump` de la base completa (CRM y agente) y un `tar`
de los adjuntos en el volumen `wassapi-pilot_backups`, con suma de verificación y 14 días de retención. Los domingos
restaura el último dump en una base temporal y comprueba que tiene tablas; el servicio queda `unhealthy` si el último
respaldo bueno tiene más de 26 horas.

**Ese volumen está en el mismo servidor.** Copia los respaldos a otro sitio (otro servidor, almacenamiento de objetos)
con una tarea programada, por ejemplo:

```bash
docker run --rm -v wassapi-pilot_backups:/b:ro -v "$PWD":/o alpine tar czf /o/respaldos-$(date +%F).tgz -C /b .
```

**Restaurar** en una base nueva: `pg_restore -d <base> --no-owner wassapi_<fecha>.dump`.

## 8. Antes de abrirlo a clientes

- Marca: el logo es una «W» generada sobre el color de acento. Sube el logo real en Ajustes → Apariencia.
- Revisa el nombre «Wassapi» con ONAPI y que el dominio esté disponible; el nombre incluye «Wassap», que se parece
  a la marca WhatsApp de Meta, y conviene verificarlo antes de invertir en marca.
- Pendientes de seguridad del portal (reconfirmar contraseña en acciones destructivas, 2FA, lista de IPs permitidas):
  ver `specs/065-plataforma-superadmin/spec.md`.

## 10. Despliegue desde GitHub Actions (runner en el servidor)

El workflow `.github/workflows/deploy.yml` despliega desde el runner autoalojado del propio servidor. Se lanza a mano
(Actions → Deploy → Run workflow) y solo desde `main`.

Preparación única en el servidor (usuario del runner, que debe estar en el grupo `docker`):

```bash
sudo dnf -y install rsync
sudo mkdir -p /opt/vocerocrm && sudo chown "$USER": /opt/vocerocrm
```

En GitHub (Settings → Secrets and variables → Actions) crea el secreto `CLOUDFLARE_TUNNEL_TOKEN` con el token del
túnel. En el panel de Cloudflare el hostname apunta a `https://caddy:443` con «No TLS Verify».

La primera ejecución pide el input `domain` y crea `deploy/.env` con los secretos generados en el servidor, la Nea del
fork (`ghcr.io/fernan2cruz/nea-agent`) y el túnel activado. Las siguientes no tocan el `.env`. Guarda una copia aparte.
Después sigue el paso 3 (primer superadmin).
