#!/bin/sh
# Prueba de restauración: restaura el dump más reciente en una base temporal y comprueba que tiene tablas.
# Un respaldo que nunca se ha restaurado no es un respaldo. No toca la base real.
# Env: BACKUP_DIR (por defecto ./backups/postgres) y las PG* del contenedor de respaldo.
set -eu

DIR=${BACKUP_DIR:-./backups/postgres}
DRILL=wassapi_restore_drill
LATEST=$(ls -1t "$DIR"/wassapi_*.dump 2>/dev/null | head -n 1 || true)
[ -n "$LATEST" ] || { echo "[restore-test] no hay dumps en $DIR" >&2; exit 1; }

echo "[restore-test] restaurando $LATEST en $DRILL"
trap 'psql -d postgres -qc "DROP DATABASE IF EXISTS $DRILL" >/dev/null 2>&1 || true' EXIT
psql -d postgres -qc "DROP DATABASE IF EXISTS $DRILL"
psql -d postgres -qc "CREATE DATABASE $DRILL"
pg_restore -d "$DRILL" --no-owner "$LATEST"

TABLAS=$(psql -d "$DRILL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
[ "${TABLAS:-0}" -gt 0 ] || { echo "[restore-test] la restauración quedó sin tablas" >&2; exit 1; }
echo "[restore-test] ok: $TABLAS tablas en public"
