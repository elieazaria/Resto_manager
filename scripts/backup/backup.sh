#!/usr/bin/env bash
# Sauvegarde quotidienne PostgreSQL (Supabase ou autre) vers un stockage EXTERNE.
#
#   DATABASE_URL   chaîne de connexion (Supabase : "Session pooler" 5432 — le pooler « transaction » 6543 ne convient pas à pg_dump)
#   BACKUP_DEST    s3://bucket/prefix  (R2, B2, S3…)  ou  dossier local
#   BACKUP_RETENTION_DAYS   défaut 30
#   BACKUP_AGE_RECIPIENT    (option) clé publique age : le dump est chiffré avant l'envoi
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL / AWS_DEFAULT_REGION   pour s3://
#
# Le client pg_dump doit être de version >= celle du serveur (Supabase récent : 17).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL est requis}"
: "${BACKUP_DEST:?BACKUP_DEST est requis (s3://bucket/prefix ou dossier)}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$tmp/resto-$stamp.dump"

echo "→ pg_dump ($(pg_dump --version))"
# --schema=public : uniquement nos tables (pas les schémas internes de Supabase)
pg_dump --format=custom --compress=9 --no-owner --no-privileges --schema=public \
  --dbname="$DATABASE_URL" --file="$file"

# Un dump qu'on ne peut pas relire ne vaut rien : on vérifie avant d'envoyer.
pg_restore --list "$file" >/dev/null
size="$(stat -c %s "$file")"
[ "$size" -gt 2048 ] || { echo "Dump suspect ($size octets), abandon" >&2; exit 1; }
tables="$(pg_restore --list "$file" | grep -c ' TABLE DATA ' || true)"
echo "  dump valide : $size octets, $tables table(s) de données"

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || { echo "age n'est pas installé" >&2; exit 1; }
  age -r "$BACKUP_AGE_RECIPIENT" -o "$file.age" "$file"
  rm -f "$file"
  file="$file.age"
  echo "  chiffré avec age"
fi

name="$(basename "$file")"
sub="$(date -u +%Y/%m)"
case "$BACKUP_DEST" in
  s3://*)
    command -v aws >/dev/null || { echo "aws cli requis pour s3://" >&2; exit 1; }
    aws s3 cp --only-show-errors "$file" "${BACKUP_DEST%/}/$sub/$name"
    echo "→ envoyé : ${BACKUP_DEST%/}/$sub/$name"
    ;;
  *)
    mkdir -p "${BACKUP_DEST%/}/$sub"
    cp "$file" "${BACKUP_DEST%/}/$sub/$name"
    echo "→ copié : ${BACKUP_DEST%/}/$sub/$name"
    ;;
esac

BACKUP_DEST="$BACKUP_DEST" BACKUP_RETENTION_DAYS="$RETENTION_DAYS" "$HERE/prune.sh"
