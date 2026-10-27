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
- `ALLOW_SIGNUP=true` solo hasta crear la primera cuenta (paso 3).
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

1. Con `ALLOW_SIGNUP=true`, abre `https://crm.tudominio.com` y crea tu cuenta.
2. Otórgale superadmin:
   ```bash
   docker compose -f docker-compose.prod.yml exec app node platform-grant.mjs tu@correo.com
   ```
3. Pon `ALLOW_SIGNUP=` (vacío) en el `.env` y recrea la app: `docker compose -f docker-compose.prod.yml up -d app`.
4. Entra a `https://crm.tudominio.com/platform`: negocios, usuarios, IA y crédito, consumo, accesos, auditoría.

## 4. Conectar WhatsApp

La URL del webhook de cada número en Meta es `https://crm.tudominio.com/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>`
(el token está en `.env`). El resto de la conexión se hace desde la app del negocio.

## 5. Varios negocios y el agente (Nea)

- Con la imagen oficial de Nea (`NEA_IMAGE` por defecto) la plataforma sirve **un solo negocio** con agente.
- Para varios negocios con agente, construye la Nea del fork y define en `.env`:
  `NEA_IMAGE=wassapi-nea`, `NEA_VERSION=1`, `NEA_VOCERO_MODE=cloud`, `NEA_CRM_SURFACE=bot`.
  Esta ruta está probada con pruebas unitarias, pero **no de punta a punta con dos negocios**: pruébala en el piloto
  antes de dar un segundo negocio a un cliente.

## 6. Operación

| Qué | Cómo |
|---|---|
| Estado | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Actualizar | `git pull && ./scripts/deploy.sh --build v2` (cambia la etiqueta en cada versión) |
| Reversión manual | `./scripts/deploy.sh --build <etiqueta anterior>` (la imagen anterior sigue en el servidor) |
| Respaldo ahora | `docker compose -f docker-compose.prod.yml exec -e BACKUP_DIR=/backups/postgres backup sh /scripts/backup-postgres.sh` |
| Cloudflare Tunnel | `CADDY_TLS=tls internal`, `BIND_ADDR=127.0.0.1`, `CLOUDFLARE_TUNNEL_TOKEN=…` y `--profile tunnel` |

Las migraciones corren al arrancar la app. La reversión devuelve la imagen, no el esquema de la base: toda migración
debe ser aditiva (primero se añade, después se retira lo viejo).

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
