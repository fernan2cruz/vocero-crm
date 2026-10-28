#!/bin/sh
# Despliega una versión en el servidor y revierte sola si la app no queda sana. Mismo flujo que DomiaX.
#   ./scripts/deploy.sh --build v1     construye la imagen desde este árbol (../) y la etiqueta v1 (sin registro)
#   ./scripts/deploy.sh v1             descarga WASSAPI_IMAGE:v1 del registro (si publicas imágenes)
#
# La reversión solo regresa la IMAGEN. La base conserva el esquema al que migró la versión nueva (las migraciones
# corren al arrancar la app), por eso toda migración debe ser aditiva (expandir y luego contraer).
set -eu
cd "$(dirname "$0")/.."

MODE=pull
if [ "${1:-}" = "--build" ]; then MODE=build; shift; fi
if [ "${1:-}" = "--rollback" ]; then MODE=rollback; shift; fi
if [ "$MODE" = rollback ]; then
  NEW_TAG=$(cat .previous_tag 2>/dev/null || true)
  [ -n "$NEW_TAG" ] || { echo "no hay etiqueta previa guardada" >&2; exit 1; }
else
  NEW_TAG=${1:?uso: deploy.sh [--build] <etiqueta-de-imagen> | --rollback}
fi
COMPOSE="docker compose -f docker-compose.prod.yml"
STATE=.deployed_tag
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-240}

[ -f .env ] || { echo "falta deploy/.env (corre ./scripts/gen-env.sh tu.dominio)" >&2; exit 1; }
# El .env NO se carga como shell (un valor con espacios, como «tls internal», lo rompería): Compose lo lee solo.
WASSAPI_IMAGE=$(sed -n 's/^WASSAPI_IMAGE=//p' .env | tail -n 1)
WASSAPI_IMAGE=${WASSAPI_IMAGE:-wassapi-crm}
PREV_TAG=$(cat "$STATE" 2>/dev/null || true)

set_tag() {
  if grep -q '^IMAGE_TAG=' .env; then sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env; else echo "IMAGE_TAG=$1" >> .env; fi
}

# La salud, vista desde dentro del contenedor: no depende de DNS ni del certificado.
healthy() {
  $COMPOSE exec -T app wget -q -O /dev/null http://127.0.0.1:3000/api/health >/dev/null 2>&1
}

wait_healthy() {
  end=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$end" ]; do
    healthy && return 0
    sleep 5
  done
  return 1
}

# Respaldo antes de tocar nada: un despliegue fallido nunca puede ser la única copia de los datos.
if $COMPOSE ps --status running --services 2>/dev/null | grep -qx backup; then
  echo "== respaldo previo al despliegue"
  $COMPOSE exec -T -e BACKUP_DIR=/backups/postgres backup /bin/sh /scripts/backup-postgres.sh \
    || { echo "el respaldo previo falló; se aborta" >&2; exit 1; }
else
  echo "== primer despliegue (nada corriendo): sin respaldo previo"
fi

echo "== desplegando $NEW_TAG (anterior: ${PREV_TAG:-ninguna}, modo: $MODE)"
if [ "$MODE" = build ]; then
  # Se construye ANTES de tocar nada: si el build falla, lo que corre y el .env quedan como estaban.
  echo "== construyendo la imagen"
  IMAGE_TAG="$NEW_TAG" $COMPOSE build app backup
fi
set_tag "$NEW_TAG"
desplegar() {
  if [ "$MODE" = pull ]; then
    $COMPOSE pull app || return 1
  fi
  $COMPOSE up -d --no-build --remove-orphans || return 1
  wait_healthy
}

if desplegar; then
  if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then echo "$PREV_TAG" > .previous_tag; fi
  echo "$NEW_TAG" > "$STATE"
  echo "== sano; despliegue de $NEW_TAG completo"
  docker image prune -f >/dev/null 2>&1 || true
  if [ "$MODE" = build ]; then
    # Solo se guardan la imagen nueva y la anterior (el disco es finito; la anterior es el destino de reversión).
    repo="$WASSAPI_IMAGE"
    docker images --format '{{.Repository}}:{{.Tag}}' "$repo" | grep -v -e ":${NEW_TAG}\$" -e ":${PREV_TAG:-none}\$" | xargs -r docker rmi >/dev/null 2>&1 || true
  fi
  exit 0
fi

echo "== $NEW_TAG NO quedó sano en ${HEALTH_TIMEOUT}s" >&2
$COMPOSE logs --tail=60 app >&2 || true
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
  echo "== revirtiendo a $PREV_TAG" >&2
  set_tag "$PREV_TAG"
  if $COMPOSE up -d --no-build --remove-orphans && wait_healthy; then echo "== reversión a $PREV_TAG exitosa" >&2; else echo "== LA REVERSIÓN TAMBIÉN FALLÓ: intervención manual" >&2; fi
else
  echo "== primer despliegue: no hay versión previa; se deja como está para inspeccionar (docker compose -f docker-compose.prod.yml logs)" >&2
fi
exit 1
