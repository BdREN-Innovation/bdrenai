#!/usr/bin/env bash
# Backup and restore verification script for BDREN PostgreSQL databases (zitadel & bdren).
# Usage:
#   scripts/backup_restore.sh backup            -> creates timestamped .dump files in ./backups/
#   scripts/backup_restore.sh verify-restore    -> backs up bdren DB, restores into temp DB, verifies table counts, drops temp DB
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

mkdir -p backups
TS=$(date -u +"%Y%m%dT%H%M%SZ")

case "${1:-backup}" in
  backup)
    for db in "$BDREN_DB_NAME" "$ZITADEL_DB_NAME"; do
      out="backups/${db}_${TS}.dump"
      docker compose exec -T postgres pg_dump -Fc -U "$POSTGRES_ADMIN_USER" -d "$db" > "$out"
      chmod 600 "$out"
      echo "Backed up $db -> $out ($(wc -c < "$out") bytes)"
    done
    ;;
  verify-restore)
    out="backups/${BDREN_DB_NAME}_verify_${TS}.dump"
    docker compose exec -T postgres pg_dump -Fc -U "$POSTGRES_ADMIN_USER" -d "$BDREN_DB_NAME" > "$out"
    chmod 600 "$out"
    tmp_db="${BDREN_DB_NAME}_restore_verify"
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_ADMIN_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$tmp_db\";" -c "CREATE DATABASE \"$tmp_db\";"
    docker compose exec -T postgres pg_restore -U "$POSTGRES_ADMIN_USER" -d "$tmp_db" --no-owner --no-privileges < "$out"
    count=$(docker compose exec -T postgres psql -tA -U "$POSTGRES_ADMIN_USER" -d "$tmp_db" -c "SELECT count(*) FROM products_product;")
    docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_ADMIN_USER" -d postgres -c "DROP DATABASE \"$tmp_db\";"
    echo "Restore verification succeeded: products_product rows=$count"
    ;;
  *)
    echo "Usage: $0 {backup|verify-restore}" >&2
    exit 1
    ;;
esac
