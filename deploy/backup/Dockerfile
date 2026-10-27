# Imagen de respaldos: pg_dump/pg_restore/psql (cliente de postgres 16) + tzdata.
# Corre como root a propósito: solo escribe en el volumen /backups, sin capacidades, sin puertos y en la red interna.
FROM postgres:16-alpine
RUN apk add --no-cache tzdata
ENTRYPOINT ["/bin/sh"]
