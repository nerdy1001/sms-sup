#!/usr/bin/env bash
# Run once on the server, after tailscale up, as root:
#   sudo /opt/staging/bin/init-staging.sh <name of this machine on the tailnet, ending in .ts.net>
# It creates the two database passwords on the server (it never exists anywhere else) and the settings file.
set -euo pipefail

ROOT="${STAGING_ROOT:-/opt/staging}"
hostname="${1:-}"
[[ "$hostname" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$ ]] || {
  echo "init-staging: give the full Tailscale name, for example sms-staging.tail1234.ts.net" >&2
  exit 1
}

install -d -m 0700 "$ROOT/secrets"
# Two different passwords: the owner of the database (used by postgres and by the migration job) and the
# application role (the only one the running application can read). Each is made once and kept.
for name in postgres_password app_password; do
  if [ ! -f "$ROOT/secrets/$name" ]; then
    head -c 32 /dev/urandom | base64 | tr -d '/+=\n' >"$ROOT/secrets/$name"
    # Readable by the user inside its container; the folder above stays root only.
    chmod 0444 "$ROOT/secrets/$name"
  fi
done
install -d -m 0755 "$ROOT/releases"
printf 'STAGING_HOSTNAME=%s\n' "$hostname" >"$ROOT/.env"
chmod 0644 "$ROOT/.env"
if id deploy >/dev/null 2>&1; then chown deploy:deploy "$ROOT" "$ROOT/releases"; fi
echo "init-staging: done. Staging will be reachable at https://$hostname after the first deployment."
