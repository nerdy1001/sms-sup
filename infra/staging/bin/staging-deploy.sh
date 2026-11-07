#!/usr/bin/env bash
# The only thing the deploy key can run (a forced command in authorized_keys). The key can deploy,
# roll back and show the status. It cannot open a shell. GitHub Actions calls it as:
#   tar -cf - release | ssh deploy@server "deploy <40 hex characters of the commit>"
set -euo pipefail
umask 027

ROOT="${STAGING_ROOT:-/opt/staging}"
KEEP=5
COMMAND="${SSH_ORIGINAL_COMMAND:-}"
UPLOAD=""
trap '[ -z "$UPLOAD" ] || rm -f "$UPLOAD"' EXIT

fail() {
  echo "staging-deploy: $*" >&2
  exit 1
}

[ -d "$ROOT" ] || fail "$ROOT does not exist"
exec 9>"$ROOT/.lock"
flock -n 9 || fail "another deployment is running"

compose() {
  local dir="$1"
  shift
  docker compose --env-file "$ROOT/.env" -f "$dir/compose.yaml" "$@"
}

read_state() { [ -f "$ROOT/$1" ] && cat "$ROOT/$1" || true; }

# Sets what the Compose file needs to know about this release and this machine.
# It also checks that the images this release needs exist, so that a wrong tag stops everything before
# the database is touched. Calling it twice for the same release does the work once.
PREPARED=""
prepare() {
  local version="$1" dir="$ROOT/releases/$1"
  [ "$PREPARED" != "$version" ] || return 0
  [ -d "$dir" ] || fail "release $version is not on this server"
  APP_VERSION="$version"
  TAILSCALE_IP="$(tailscale ip -4 | head -n 1)"
  [ -n "$TAILSCALE_IP" ] || fail "this server has no Tailscale address; run tailscale up first"
  export APP_VERSION TAILSCALE_IP
  local image
  for image in $(compose "$dir" config --images | grep -v '^minesup/'); do
    docker manifest inspect "$image" >/dev/null 2>&1 || fail "the image $image does not exist in its registry"
  done
  PREPARED="$version"
}

# Changes the structure of the database, before the new version starts. Returns non-zero if it could not.
# The running version is untouched: only the database service is started here, and the migration is a
# one-off container made from the new image (service "migrate", which belongs to the "tools" profile and
# is therefore never started by "up"). It runs the migrations as the database owner and then gives the
# application role its password. The old version keeps serving while this happens.
migrate_database() {
  local version="$1" dir="$ROOT/releases/$1"
  compose "$dir" up -d --wait --wait-timeout 120 postgres || return 1
  # A copy of the data before its structure changes. On the very first deployment there is nothing to copy.
  if [ -n "$(read_state current)" ]; then
    "$ROOT/bin/backup.sh" || return 1
  fi
  compose "$dir" run --rm --no-deps migrate || return 1
}

# Starts a release and proves that the new version is the one that answers.
bring_up() {
  local version="$1" dir="$ROOT/releases/$1"
  prepare "$version"
  compose "$dir" up -d --remove-orphans --wait --wait-timeout 120 || return 1
  local answer
  answer="$(compose "$dir" exec -T core-api wget -qO- http://127.0.0.1:3000/health)" || return 1
  [[ "$answer" == *"\"version\":\"$version\""* ]] || return 1
}

deploy() {
  local version="$1"
  [[ "$version" =~ ^[0-9a-f]{40}$ ]] || fail "the version must be a 40 character commit id"
  local dir="$ROOT/releases/$version"
  UPLOAD="$(mktemp "$ROOT/upload.XXXXXX")"
  cat >"$UPLOAD"

  # The upload must contain exactly three regular files, nothing else.
  local expected listing
  expected=$'Caddyfile\ncompose.yaml\nimage.tar.gz'
  listing="$(tar -tf "$UPLOAD" | sed 's#^\./##' | sort)"
  [ "$listing" = "$expected" ] || fail "the upload does not contain exactly: Caddyfile, compose.yaml, image.tar.gz"
  if tar -tvf "$UPLOAD" | grep -qv '^-'; then fail "the upload contains something other than regular files"; fi

  rm -rf "$dir"
  mkdir -p "$dir"
  tar -xf "$UPLOAD" -C "$dir" --no-same-owner --no-same-permissions
  docker load -i "$dir/image.tar.gz" >/dev/null

  local current previous
  current="$(read_state current)"
  # Migrations run only when deploying, never when rolling back: an older release does not know the
  # newest migration files and would refuse to run against a database that has applied them. That is
  # why a migration must work for the old version too (docs/adr/0005-staging-environment.md, decision 10).
  prepare "$version"
  if ! migrate_database "$version"; then
    echo "staging-deploy: the database migration failed; version $version was not started and $current keeps running" >&2
    exit 1
  fi
  if bring_up "$version"; then
    if [ -n "$current" ] && [ "$current" != "$version" ]; then echo "$current" >"$ROOT/previous"; fi
    echo "$version" >"$ROOT/current"
    echo "deployed $version"
    prune
  else
    echo "staging-deploy: version $version failed its health check" >&2
    previous="$current"
    if [ -n "$previous" ] && [ "$previous" != "$version" ] && bring_up "$previous"; then
      echo "staging-deploy: rolled back to $previous" >&2
    fi
    exit 1
  fi
}

rollback() {
  local current previous
  current="$(read_state current)"
  previous="$(read_state previous)"
  [ -n "$previous" ] || fail "there is no previous release to go back to"
  bring_up "$previous"
  echo "$previous" >"$ROOT/current"
  echo "$current" >"$ROOT/previous"
  echo "rolled back to $previous"
}

prune() {
  local old
  # shellcheck disable=SC2012
  for old in $(ls -1t "$ROOT/releases" | tail -n +$((KEEP + 1))); do
    docker image rm "minesup/core-api:$old" "minesup/staff-web:$old" >/dev/null 2>&1 || true
    rm -rf "${ROOT:?}/releases/$old"
  done
}

case "$COMMAND" in
  "deploy "*) deploy "${COMMAND#deploy }" ;;
  rollback) rollback ;;
  status)
    echo "current:  $(read_state current)"
    echo "previous: $(read_state previous)"
    ;;
  *) fail "unknown command; use: deploy <commit>, rollback, status" ;;
esac
