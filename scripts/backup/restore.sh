#!/usr/bin/env bash
# Restaure une sauvegarde dans une base CIBLE.
#   ./restore.sh <fichier.dump | fichier.dump.age | s3://bucket/chemin.dump> <URL_BASE_CIBLE>
# Pour une chiffrée (.age) : AGE_IDENTITY=chemin/vers/cle-privee.txt
# ⚠ Remplace les tables existantes de la base cible : exigez CONFIRM=yes.
set -euo pipefail
src="${1:?fichier ou s3:// requis}"; target="${2:?URL de la base cible requise}"
[ "${CONFIRM:-}" = "yes" ] || { echo "Ceci REMPLACE les données de la cible. Relancez avec CONFIRM=yes" >&2; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
case "$src" in
  s3://*) aws s3 cp --only-show-errors "$src" "$tmp/in"; f="$tmp/in" ;;
  *) f="$src" ;;
esac
if [[ "$src" == *.age ]]; then
  : "${AGE_IDENTITY:?AGE_IDENTITY (clé privée age) requis pour un dump chiffré}"
  age -d -i "$AGE_IDENTITY" -o "$tmp/out.dump" "$f"; f="$tmp/out.dump"
fi

pg_restore --list "$f" >/dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$target" "$f"
echo "Restauration terminée."
