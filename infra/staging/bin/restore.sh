#!/usr/bin/env bash
# Restores or verifies a backup of the staging database.
#   restore.sh verify            restores the newest backup into a scratch database, counts its tables, deletes it
#   restore.sh apply <file> yes  replaces the staging database with the backup (destroys current data)
set -euo pipefail

DIR="${STAGING_BACKUP_DIR:-/var/backups/staging}"

container="$(docker ps -q --filter label=com.docker.compose.project=staging --filter label=com.docker.compose.service=postgres)"
[ -n "$container" ] || { echo "restore: the database container is not running" >&2; exit 1; }

psql_run() { docker exec -i "$container" psql -U sms -d postgres -v ON_ERROR_STOP=1 "$@"; }

case "${1:-}" in
  verify)
    # shellcheck disable=SC2012
    file="$(ls -1t "$DIR"/sms-*.dump 2>/dev/null | head -n 1 || true)"
    [ -n "$file" ] || { echo "restore: there is no backup in $DIR" >&2; exit 1; }
    psql_run -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check"
    docker exec -i "$container" pg_restore -U sms -d restore_check --no-owner <"$file"
    tables="$(docker exec -i "$container" psql -U sms -d restore_check -tAc "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")"
    psql_run -c "DROP DATABASE restore_check"
    echo "restore: $file restored into a scratch database with $tables table(s); the scratch database was deleted"
    ;;
  apply)
    file="${2:-}"
    [ -f "$file" ] || { echo "restore: give the path of a backup file" >&2; exit 1; }
    [ "${3:-}" = "yes" ] || { echo "restore: this replaces the staging database. Add the word yes to confirm." >&2; exit 1; }
    docker exec -i "$container" pg_restore -U sms -d sms --clean --if-exists --no-owner <"$file"
    echo "restore: staging database replaced from $file"
    ;;
  *)
    echo "usage: restore.sh verify | restore.sh apply <file> yes" >&2
    exit 1
    ;;
esac
