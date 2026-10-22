#!/usr/bin/env bash
# Runs on the server, from the deploy directory. Called by the Deploy workflow:
#   printf '%s' "$REGISTRY_TOKEN" | IMAGE=ghcr.io/owner/session-relay REGISTRY_USER=me bash deploy-remote.sh <tag>
# Backs up the database, starts the new image, health-checks it, and rolls back on failure.
# SKIP_PULL=1 uses a local image (for testing this script).
set -euo pipefail

TAG="${1:?usage: deploy-remote.sh <image tag>}"
: "${IMAGE:?IMAGE must be set}"
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing .env in $PWD (copy .env.example from the repo and fill it in)."; exit 1; }
set -a; . ./.env; set +a
PORT="${SERVER_PORT:-8787}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
PREV="$(cat .current_tag 2>/dev/null || true)"
log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

if [ -z "${SKIP_PULL:-}" ]; then
  if [ -n "${REGISTRY_USER:-}" ] && [ ! -t 0 ]; then
    read -r TOKEN || true
    [ -n "${TOKEN:-}" ] && printf '%s' "$TOKEN" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
  fi
  log "pulling $IMAGE:$TAG"
  IMAGE_TAG="$TAG" docker compose pull server
  docker logout ghcr.io >/dev/null 2>&1 || true
fi

# Back up before anything changes. Skipped on the very first deploy (no database yet).
if docker compose ps --status running --services | grep -qx postgres; then
  mkdir -p backups
  FILE="backups/relay-$(date -u +%Y%m%dT%H%M%SZ)-before-$TAG.sql.gz"
  docker compose exec -T postgres pg_dump -U relay -d relay | gzip > "$FILE"
  log "database backed up to $FILE"
  ls -1t backups/*.sql.gz | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm --
fi

healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

log "starting $TAG (previous: ${PREV:-none})"
IMAGE_TAG="$TAG" docker compose up -d --remove-orphans

if healthy; then
  # Manual `docker compose ...` commands (bootstrap, psql) run the live image via :current.
  docker tag "$IMAGE:$TAG" "$IMAGE:current"
  echo "$TAG" > .current_tag
  [ -n "$PREV" ] && [ "$PREV" != "$TAG" ] && echo "$PREV" > .previous_tag
  log "healthy on :$PORT, $TAG is live"
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

log "health check failed for $TAG; last server logs:"
IMAGE_TAG="$TAG" docker compose logs --tail 40 server || true
if [ -n "$PREV" ]; then
  log "rolling back to $PREV"
  IMAGE_TAG="$PREV" docker compose up -d --remove-orphans
  if healthy; then
    docker tag "$IMAGE:$PREV" "$IMAGE:current"
    log "rolled back, $PREV is live"
  else
    log "rollback to $PREV is not healthy either; check the server"
  fi
else
  log "no previous version to roll back to"
fi
exit 1
