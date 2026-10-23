#!/usr/bin/env bash
# First-run setup on the server, run by ci-deploy.sh before every deploy. Safe to re-run:
# it never overwrites an existing .env.
#   PUBLIC_HOST=<server ip or name> bash server-setup.sh
# Creates .env with a random database password and picks how HTTPS is served:
# - DOMAIN set (or derived from an IP via sslip.io) and ports 80/443 free -> Caddy with automatic certificates
# - ports 80/443 already taken by another proxy -> API on 127.0.0.1:SERVER_PORT, proxy it yourself
set -euo pipefail
cd "$(dirname "$0")"
log() { printf '[setup] %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on $(hostname). Install it once, then re-run the deploy:"
  echo "  curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER   # then log out and back in"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "$USER cannot talk to Docker. Run once: sudo usermod -aG docker $USER  (then log out and back in, or reboot)"
  exit 1
fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is missing (docker compose ...). Install the compose plugin."; exit 1; }

if [ -f .env ]; then
  log ".env exists, leaving it as is"
  exit 0
fi

port_free() { ! (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print $4}' | grep -qE "[:.]$1\$"; }

HOST="${PUBLIC_HOST:-}"
DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ] && [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  # sslip.io resolves relay.1-2-3-4.sslip.io to 1.2.3.4, so HTTPS works without owning a domain.
  DOMAIN="relay.${HOST//./-}.sslip.io"
elif [ -z "$DOMAIN" ]; then
  DOMAIN="$HOST"
fi

PORT=8787
while ! port_free "$PORT"; do PORT=$((PORT + 1)); done

if [ -n "$DOMAIN" ] && port_free 80 && port_free 443; then
  PROFILES=tls
  URL="https://$DOMAIN"
  log "ports 80/443 are free: Caddy will serve https://$DOMAIN"
else
  PROFILES=
  URL="http://${DOMAIN:-127.0.0.1}:$PORT"
  log "ports 80/443 are in use (or no domain): not starting Caddy. Point your proxy at 127.0.0.1:$PORT"
fi

umask 077
cat > .env <<ENV
# Created by server-setup.sh on $(date -u +%Y-%m-%dT%H:%MZ). Edit and redeploy to change.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
PUBLIC_URL=$URL
DOMAIN=$DOMAIN
COMPOSE_PROFILES=$PROFILES
SERVER_PORT=$PORT
STORAGE_DRIVER=local
ENV
log "wrote .env (PUBLIC_URL=$URL, SERVER_PORT=$PORT)"
