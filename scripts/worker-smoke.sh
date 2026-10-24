#!/usr/bin/env bash
# Smoke test for the Cloudflare Worker build, run against `wrangler dev` and a real Postgres.
#   DATABASE_URL=postgres://user:pass@host/db scripts/worker-smoke.sh
# Covers first-run setup, invite links, browser login, sharing with R2 transcripts,
# handoff chains, rate limiting and the Cron cleanup.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL (with a password: local Hyperdrive requires one)}"
PORT="${WORKER_PORT:-8790}"
URL="http://localhost:$PORT"
CODE="SMKE-TEST-CODE"
LOG=$(mktemp)
json() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);console.log(eval(process.argv[1]))})' "$1"; }
ok() { echo "  ✓ $*"; }
die() { echo "  ✗ $*"; echo "--- wrangler log"; tail -40 "$LOG"; exit 1; }
api() { local method=$1 path=$2 token=${3:-} body=${4:-}; curl -s -X "$method" "$URL$path" -H 'content-type: application/json' ${token:+-H "authorization: Bearer $token"} ${body:+-d "$body"}; }

node packages/server/dist/db/migrate-cli.js >/dev/null
(cd packages/server && CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DATABASE_URL" \
  npx wrangler dev --port "$PORT" --var "PUBLIC_URL:$URL" --var "SETUP_CODE:$CODE" > "$LOG" 2>&1 &)
trap 'pkill -f "wrangler dev --port $PORT" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do curl -sf "$URL/health" >/dev/null 2>&1 && break; sleep 2; done
[ "$(curl -s "$URL/health" | json o.ok)" = true ] && ok "worker healthy" || die "worker did not start"
curl -s "$URL/" | grep -q '<div id="root">' && ok "web app served from static assets" || die "web app missing"

OWNER=$(api POST /v1/setup "" "{\"code\":\"$CODE\",\"org\":\"Smoke\",\"name\":\"Ada\",\"email\":\"ada@smoke.dev\"}" | json o.token)
[ "$(api GET /v1/me "$OWNER" | json o.role)" = owner ] && ok "first-run setup with SETUP_CODE" || die "setup failed"
[ "$(api GET /v1/setup | json o.needed)" = false ] && ok "setup closed"

SECRET=$(api POST /v1/invites "$OWNER" '{"role":"member"}' | json 'o.url.split("/join/")[1]')
BOB=$(api POST "/v1/join/$SECRET" "" '{"name":"Bob","email":"bob@smoke.dev"}' | json o.token)
[ "$(api GET /v1/me "$BOB" | json o.user.name)" = Bob ] && ok "invite link" || die "invite failed"

START=$(api POST /v1/auth/device "" '{"client_name":"ci"}')
api POST /v1/auth/device/approve "$BOB" "{\"user_code\":\"$(echo "$START" | json o.user_code)\"}" >/dev/null
CLI=$(api POST /v1/auth/device/token "" "{\"device_code\":\"$(echo "$START" | json o.device_code)\"}" | json o.token)
[ "$(api GET /v1/me "$CLI" | json o.user.name)" = Bob ] && ok "browser login" || die "device login failed"

MSGS='[{"role":"user","text":"retry webhooks"},{"role":"assistant","text":"done with idempotency keys"}]'
UP="{\"session\":{\"source\":{\"tool\":\"claude-code\",\"native_id\":\"x\"},\"repo\":\"github.com/acme/api\",\"title\":\"Smoke share\",\"summary\":{\"goal\":\"retry webhooks\"},\"messages\":$MSGS,\"include\":\"full\"},\"transcript\":$MSGS}"
A=$(api POST /v1/sessions "$OWNER" "$UP" | json o.id)
[ "$(api GET "/v1/sessions/$A?mode=full" "$BOB" | json o.message_total)" = 2 ] && ok "share with full transcript in R2" || die "R2 transcript failed"
[ "$(api GET "/v1/sessions?q=idempotency" "$BOB" | json 'o.sessions.length')" = 1 ] && ok "search"
B=$(api POST /v1/sessions "$BOB" "{\"session\":{\"source\":{\"tool\":\"opencode\",\"native_id\":\"y\"},\"repo\":\"github.com/acme/api\",\"title\":\"Smoke continued\",\"summary\":{\"goal\":\"g\"},\"include\":\"summary\",\"continues\":\"$A\"}}" | json o.id)
[ "$(api GET "/v1/sessions/$B?mode=summary" "$OWNER" | json 'o.chain[0].id')" = "$A" ] && ok "handoff chain" || die "chain failed"

last=""; for i in $(seq 1 32); do last=$(curl -s -o /dev/null -w '%{http_code}' "$URL/v1/join/inv_nope$i"); done
[ "$last" = 429 ] && ok "rate limit" || die "rate limit gave $last"

api DELETE "/v1/sessions/$A" "$OWNER" >/dev/null
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/v1/sessions/$A" -H "authorization: Bearer $BOB")" = 404 ] && ok "delete removes share and transcript"

curl -s -X POST "$URL/cdn-cgi/local/explorer/api/local/scheduled?worker=session-relay" -H 'content-type: application/json' -d '{"cron":"17 * * * *"}' | grep -q '"outcome":"ok"' && ok "cron trigger runs" || die "cron failed"
echo "Worker smoke test passed"
