#!/bin/sh
# Crea deploy/.env desde .env.example con los secretos ya generados (necesita openssl, que AlmaLinux trae).
#   ./scripts/gen-env.sh crm.tudominio.com
# No sobreescribe un .env existente. GUARDA UNA COPIA del .env en un lugar seguro y APARTE del servidor:
# ENCRYPTION_KEY cifra los secretos guardados en la base; sin ella, un respaldo de la base no los recupera.
set -eu
cd "$(dirname "$0")/.."

DOMAIN=${1:?uso: gen-env.sh <dominio>   p. ej. crm.tudominio.com}
[ -e .env ] && { echo "ya existe deploy/.env: no se sobreescribe" >&2; exit 1; }
command -v openssl >/dev/null || { echo "falta openssl" >&2; exit 1; }

cp .env.example .env
chmod 600 .env
sub() { sed -i "s|^$1=.*|$1=$2|" .env; }
sub DOMAIN "$DOMAIN"
sub POSTGRES_PASSWORD "$(openssl rand -hex 24)"
sub BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
sub ENCRYPTION_KEY "$(openssl rand -base64 32)"
sub META_WEBHOOK_VERIFY_TOKEN "$(openssl rand -hex 12)"
sub BOT_API_KEY "$(openssl rand -hex 32)"

echo "deploy/.env creado (permisos 600)."
echo "Revisa lo opcional (TLS, correo de Let's Encrypt, IA) y guarda una copia aparte."
echo "Siguiente paso:  ./scripts/deploy.sh --build v1"
