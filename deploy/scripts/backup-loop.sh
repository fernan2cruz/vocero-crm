#!/bin/sh
# Planificador del servicio `backup` (sin cron): corre los respaldos una vez al día a las BACKUP_HOUR_UTC y una
# prueba de restauración del último dump cada domingo. Escribe /backups/status/last_success para el healthcheck.
set -u

HOUR=${BACKUP_HOUR_UTC:-07}
STATUS_DIR=/backups/status
mkdir -p "$STATUS_DIR" /backups/postgres /backups/files

run_all() {
  ok=1
  BACKUP_DIR=/backups/postgres sh /scripts/backup-postgres.sh || ok=0
  BACKUP_DIR=/backups/files    sh /scripts/backup-files.sh    || ok=0
  if [ "$(date -u +%u)" = 7 ]; then
    BACKUP_DIR=/backups/postgres sh /scripts/restore-postgres-test.sh || ok=0
  fi
  if [ "$ok" = 1 ]; then date -u +%s > "$STATUS_DIR/last_success"; else echo "[backup-loop] FALLÓ $(date -u +%FT%TZ)" >&2; date -u +%s > "$STATUS_DIR/last_failure"; fi
}

# Un respaldo tomado antes de que la app migre la base saldría vacío: se espera (hasta 10 min) a que haya tablas.
esperar_migraciones() {
  n=0
  while [ "$n" -lt 120 ]; do
    t=$(psql -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null || echo 0)
    [ "${t:-0}" -gt 0 ] && return 0
    n=$((n + 1)); sleep 5
  done
  return 0
}

if [ "${BACKUP_ON_START:-0}" = 1 ]; then esperar_migraciones; run_all; fi

while :; do
  now=$(date -u +%s)
  today_target=$(date -u -d "$(date -u +%F) $HOUR:00:00" +%s 2>/dev/null || date -u +%s)
  if [ "$now" -ge "$today_target" ]; then next=$((today_target + 86400)); else next=$today_target; fi
  echo "[backup-loop] próxima corrida $(date -u -d "@$next" +%FT%TZ)"
  sleep $((next - now))
  run_all
done
