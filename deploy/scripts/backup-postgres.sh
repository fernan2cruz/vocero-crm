#!/bin/sh
# Respaldo lógico de la base de Wassapi (formato custom, comprimido, verificado, con retención).
# Incluye los dos esquemas: `public` (el CRM) y `nea` (el agente), porque viven en la misma base.
# Usa PGHOST/PGUSER/PGPASSWORD/PGDATABASE del contenedor de respaldo.
# Env: BACKUP_DIR (por defecto ./backups/postgres)  BACKUP_RETENTION_DAYS (por defecto 14)
set -eu

OUT_DIR=${BACKUP_DIR:-./backups/postgres}
RETENTION=${BACKUP_RETENTION_DAYS:-14}
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT_DIR/wassapi_${TS}.dump"
TMP="$FILE.partial"

mkdir -p "$OUT_DIR"
trap 'rm -f "$TMP"' EXIT

echo "[backup-postgres] $(date -u +%FT%TZ) inicio -> $FILE"
pg_dump -Fc -Z 6 --no-owner > "$TMP"
pg_restore --list "$TMP" > /dev/null   # verificación estructural

[ -s "$TMP" ] || { echo "[backup-postgres] dump vacío, se aborta" >&2; exit 1; }
mv "$TMP" "$FILE"
( cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
echo "[backup-postgres] ok $(wc -c < "$FILE") bytes"

# Retención: el dump recién escrito siempre se conserva; los de más de N días se borran con su suma.
find "$OUT_DIR" -maxdepth 1 -name 'wassapi_*.dump' -mtime +"$RETENTION" -print -exec rm -f {} {}.sha256 \;
