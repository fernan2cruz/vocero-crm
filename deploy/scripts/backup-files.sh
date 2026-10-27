#!/bin/sh
# Respaldo de los adjuntos, logo e icono (volumen `media`, montado de solo lectura en /data).
# Env: BACKUP_DIR (por defecto ./backups/files)  BACKUP_RETENTION_DAYS (por defecto 14)
set -eu

OUT_DIR=${BACKUP_DIR:-./backups/files}
RETENTION=${BACKUP_RETENTION_DAYS:-14}
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT_DIR/media_${TS}.tar.gz"
TMP="$FILE.partial"

mkdir -p "$OUT_DIR"
trap 'rm -f "$TMP"' EXIT

echo "[backup-files] $(date -u +%FT%TZ) inicio -> $FILE"
if [ ! -d /data ] || [ -z "$(ls -A /data 2>/dev/null)" ]; then
  echo "[backup-files] /data vacío: nada que respaldar (instancia sin adjuntos todavía)"
  exit 0
fi
tar -czf "$TMP" -C /data .
tar -tzf "$TMP" > /dev/null   # verificación: el archivo se puede leer completo
mv "$TMP" "$FILE"
( cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
echo "[backup-files] ok $(wc -c < "$FILE") bytes"

find "$OUT_DIR" -maxdepth 1 -name 'media_*.tar.gz' -mtime +"$RETENTION" -print -exec rm -f {} {}.sha256 \;
