#!/usr/bin/env bash
# Starts a throwaway Postgres in Docker, runs the server integration tests against it, then removes it.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${TEST_PG_PORT:-54329}"
NAME="relay-test-pg-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=relay_test -p "$PORT:5432" postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres -d relay_test >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

npm run build -w @session-relay/shared >/dev/null
TEST_DATABASE_URL="postgres://postgres:test@localhost:$PORT/relay_test" npx vitest run --root packages/server src/api.integration.test.ts
