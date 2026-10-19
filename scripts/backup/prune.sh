#!/usr/bin/env bash
# Supprime les sauvegardes plus vieilles que BACKUP_RETENTION_DAYS (défaut 30).
# Garde-fou : les 5 plus récentes sont TOUJOURS conservées, même si l'horloge ou la date d'un nom est faussée.
set -euo pipefail
: "${BACKUP_DEST:?BACKUP_DEST est requis}"
DAYS="${BACKUP_RETENTION_DAYS:-30}"
KEEP_MIN=5
cutoff="$(date -u -d "-$DAYS days" +%Y%m%d)"

list() {
  case "$BACKUP_DEST" in
    s3://*) aws s3 ls --recursive "${BACKUP_DEST%/}/" | awk '{print $4}' ;;   # clés relatives au bucket
    *) (cd "${BACKUP_DEST%/}" && find . -type f -name 'resto-*.dump*' | sed 's|^\./||') ;;
  esac
}
remove() {
  case "$BACKUP_DEST" in
    s3://*)
      bucket="${BACKUP_DEST#s3://}"; bucket="${bucket%%/*}"
      aws s3 rm --only-show-errors "s3://$bucket/$1" ;;
    *) rm -f "${BACKUP_DEST%/}/$1" ;;
  esac
}

mapfile -t all < <(list | grep -E 'resto-[0-9]{8}T[0-9]{6}Z\.dump' | sort -t- -k2)
total=${#all[@]}
removable=$(( total - KEEP_MIN ))
deleted=0
for key in "${all[@]}"; do
  [ "$removable" -gt 0 ] || break
  d="$(echo "$key" | sed -E 's/.*resto-([0-9]{8})T.*/\1/')"
  if [ "$d" -lt "$cutoff" ]; then
    remove "$key"; removable=$((removable-1)); deleted=$((deleted+1))
  fi
done
echo "→ rétention ${DAYS} j : $deleted supprimée(s), $((total-deleted)) conservée(s)"
