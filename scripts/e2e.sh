#!/usr/bin/env bash
# Full local end-to-end run: Docker stack (server + Postgres + web), three users,
# real CLI against real agent sessions in a git repo, MCP client checks.
#
#   ./scripts/e2e.sh <repo-with-agent-sessions>
#
# The repo must contain at least one Claude Code or OpenCode session (run one there first).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
REPO="${1:?usage: scripts/e2e.sh <git repo that has agent sessions>}"
PORT="${E2E_PORT:-8799}"
SERVER="http://localhost:$PORT"
WORK="$(mktemp -d)"
COMPOSE=(docker compose -p relay-e2e -f deploy/docker-compose.yml --env-file "$WORK/.env")
RELAY=(node "$ROOT/packages/cli/dist/relay.js")

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
die() { printf '  ✗ %s\n' "$*" >&2; exit 1; }
as() { local who=$1; shift; (cd "$REPO" && RELAY_CONFIG="$WORK/$who.json" "${RELAY[@]}" "$@"); }

cleanup() {
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  rm -rf "$WORK" "$REPO/.relay"
}
trap cleanup EXIT

step "Build"
npm run build >/dev/null
ok "all packages built"

step "Start stack on :$PORT"
printf 'POSTGRES_PASSWORD=e2e-%s\nPUBLIC_URL=%s\nSERVER_PORT=%s\n' "$RANDOM$RANDOM" "$SERVER" "$PORT" > "$WORK/.env"
"${COMPOSE[@]}" up -d --build >/dev/null 2>&1 || { "${COMPOSE[@]}" up -d --build; exit 1; }
for _ in $(seq 1 60); do curl -sf "$SERVER/health" >/dev/null && break; sleep 1; done
curl -sf "$SERVER/health" >/dev/null || die "server did not come up"
ok "server healthy"
curl -sf "$SERVER/" | grep -q '<div id="root">' && ok "web app served at /" || die "web app not served"

step "Bootstrap org + users"
BOOT=$("${COMPOSE[@]}" exec -T server node packages/server/dist/bootstrap.js --org "E2E Team" --email alice@e2e.dev --name Alice)
ALICE_TOKEN=$(grep -oE 'srk_[A-Za-z0-9_-]+' <<<"$BOOT" | head -1)
as alice login --server "$SERVER" --token "$ALICE_TOKEN" >/dev/null
ok "alice (owner) logged in"
BOB_TOKEN=$(as alice invite bob@e2e.dev --name Bob | grep -oE 'srk_[A-Za-z0-9_-]+')
CAROL_TOKEN=$(as alice invite carol@e2e.dev --name Carol | grep -oE 'srk_[A-Za-z0-9_-]+')
as bob login --server "$SERVER" --token "$BOB_TOKEN" >/dev/null
as carol login --server "$SERVER" --token "$CAROL_TOKEN" >/dev/null
ok "bob and carol invited and logged in"
[[ $(as bob members | wc -l) -eq 3 ]] && ok "members lists 3 people" || die "members wrong"
RELAY_CONFIG="$WORK/bad.json" RELAY_SERVER="$SERVER" RELAY_TOKEN=srk_invalidtokeninvalidtoken "${RELAY[@]}" whoami 2>/dev/null && die "bad token accepted" || ok "bad token rejected"

step "Local sessions in $REPO"
as alice sessions | sed 's/^/    /'
TOOLS=$(as alice sessions | awk '{print $1}' | sort -u)

step "Dry run"
as alice share --latest --yes --dry-run | sed 's/^/    /'
ls "$REPO"/.relay/dry-run-*.json >/dev/null && ok "dry run wrote a file and uploaded nothing"
[[ $(as alice list --json | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).length))') -eq 0 ]] && ok "server still empty"

step "Share"
FIRST_ID=""
for tool in $TOOLS; do
  out=$(as alice share --tool "$tool" --latest --yes --json --title "e2e $tool math fix")
  id=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$out")
  ok "alice shared her $tool session as $id"
  FIRST_ID=${FIRST_ID:-$id}
done
FULL=$(as alice share --tool "$(head -1 <<<"$TOOLS")" --latest --yes --json --include full --title "e2e full transcript")
FULL_ID=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$FULL")
ok "full transcript shared as $FULL_ID"
PRIV=$(as alice share --latest --yes --json --people Bob --title "e2e private for bob")
PRIV_ID=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$PRIV")
ok "private share for Bob: $PRIV_ID"

step "Teammates read"
as bob list | sed 's/^/    /'
as bob list | grep -q "$FIRST_ID" && ok "bob sees alice's share in this repo"
as bob search "math" --json | grep -q "$FIRST_ID" && ok "search finds it"
as bob list | grep -q "$PRIV_ID" && ok "bob sees the private share" || die "bob cannot see private share"
as carol list | grep -q "$PRIV_ID" && die "carol can see bob's private share" || ok "carol cannot see it"
as bob show "$FIRST_ID" | head -12 | sed 's/^/    /'
as bob pull "$FIRST_ID" >/dev/null && grep -q "## Goal" "$REPO/.relay/handoff-$FIRST_ID.md" && ok "pull wrote .relay/handoff-$FIRST_ID.md"
as bob pull "$FULL_ID" --full >/dev/null && ok "pull --full fetched the whole transcript"
grep -qF "$HOME" "$REPO/.relay/handoff-$FIRST_ID.md" && die "home directory path leaked into handoff" || ok "no home paths in handoff"

step "MCP"
(cd "$ROOT" && node scripts/e2e-mcp.mjs "$REPO" "$WORK/bob.json" "$FIRST_ID") | sed 's/^/  /'

step "Permissions"
as bob delete "$FIRST_ID" --yes 2>/dev/null && die "bob deleted alice's share" || ok "bob cannot delete alice's share"
as alice delete "$FIRST_ID" --yes >/dev/null && ok "alice deleted her share"
as bob show "$FIRST_ID" >/dev/null 2>&1 && die "deleted share still readable" || ok "deleted share is gone"

step "Done"
echo "  All end-to-end checks passed."
