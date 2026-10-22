# Session Relay

Share coding-agent sessions with your team, across **Claude Code**, **Codex** and **OpenCode**. Pick a session, choose what to include and who can see it, and a teammate can continue it in their own tool. No copy-pasting.

> Status: early scaffold. Login works; sharing, listing and the MCP server are being built. See [docs/PLAN.md](docs/PLAN.md).

## Layout

| Path | What |
|---|---|
| `packages/shared` | Common session format (zod schemas, types, ids) |
| `packages/cli` | `relay` CLI: login, share, list, pull, MCP server |
| `packages/server` | API server (Hono + Postgres), migrations, bootstrap |
| `packages/web` | Web app to browse and read shared sessions |
| `deploy/` | Docker Compose for self-hosting |
| `fixtures/` | Redacted sample sessions per tool, used by adapter tests |

## Self-host

```sh
cp deploy/.env.example deploy/.env        # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

# create your org, its owner and a personal token (printed once)
docker compose -f deploy/docker-compose.yml exec server \
  node packages/server/dist/bootstrap.js --org "Your Team" --email you@example.com --name "Your Name"
```

Put a reverse proxy with TLS (Caddy, nginx) in front of the server port.

## Use the CLI

```sh
npm install && npm run build
node packages/cli/dist/index.js login --server https://relay.example.com --token srk_...
node packages/cli/dist/index.js whoami
```

## Develop

```sh
npm install
npm run build
npm test
DATABASE_URL=postgres://... npm run dev -w @session-relay/server
npm run dev -w @session-relay/web
```

## Built to be multi-tenant

Self-hosted installs run one org, but nothing assumes that. This keeps a hosted version possible later without a rewrite.

- Every tenant-owned table has `org_id`. Tokens, roles and queries are scoped to one org.
- The CLI never hardcodes a server; `relay login --server` points it anywhere.
- Full transcripts go through a `BlobStorage` interface (local disk now, S3/R2 later), keyed by org.
- Retention, repo allowlist and redaction patterns are per-org settings, not constants.
- Usage events and an audit log are recorded per org.

Signup, billing and SSO are intentionally not built yet.
