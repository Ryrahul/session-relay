#!/usr/bin/env bash
# Runs on the GitHub runner. Ships one image tag to the SSH host alias "prod":
# copies the deploy files, then runs deploy-remote.sh there (backup, start, health check, rollback).
#   IMAGE=ghcr.io/owner/session-relay DEPLOY_PATH=/opt/session-relay REGISTRY_USER=... REGISTRY_TOKEN=... scripts/ci-deploy.sh <tag>
set -euo pipefail
TAG="${1:?usage: ci-deploy.sh <tag>}"
: "${IMAGE:?}" "${DEPLOY_PATH:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"
HOST="${SSH_HOST:-prod}"

# shellcheck disable=SC2029 # values are meant to expand here, on the runner
ssh "$HOST" "mkdir -p '$DEPLOY_PATH'"
scp -q deploy/docker-compose.prod.yml "$HOST:$DEPLOY_PATH/docker-compose.yml"
scp -q deploy/Caddyfile deploy/deploy-remote.sh deploy/server-setup.sh "$HOST:$DEPLOY_PATH/"
# First deploy creates .env; later deploys leave it alone.
# shellcheck disable=SC2029
ssh "$HOST" "cd '$DEPLOY_PATH' && PUBLIC_HOST='${PUBLIC_HOST:-}' bash server-setup.sh"
# The registry token only lives for this job; deploy-remote.sh logs out after pulling.
# shellcheck disable=SC2029
printf '%s' "$REGISTRY_TOKEN" | ssh "$HOST" "cd '$DEPLOY_PATH' && IMAGE='$IMAGE' REGISTRY_USER='$REGISTRY_USER' bash deploy-remote.sh '$TAG'"
