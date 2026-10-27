#!/usr/bin/env bash
# Nightly backup of the staging database, started by cron (see cloud-init). Keeps 7 days.
set -euo pipefail
umask 077

DIR="${STAGING_BACKUP_DIR:-/var/backups/staging}"
KEEP_DAYS=7
mkdir -p "$DIR"

container="$(docker ps -q --filter label=com.docker.compose.project=staging --filter label=com.docker.compose.service=postgres)"
[ -n "$container" ] || { echo "backup: the database container is not running" >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker exec "$container" pg_dump -U sms -d sms -Fc >"$DIR/sms-$stamp.dump.partial"
mv "$DIR/sms-$stamp.dump.partial" "$DIR/sms-$stamp.dump"
find "$DIR" -name 'sms-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "backup: wrote $DIR/sms-$stamp.dump"
