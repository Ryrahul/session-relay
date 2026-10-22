# Session Relay

Share coding-agent sessions with your team across **Claude Code**, **OpenCode** and **Codex**. Pick a session, choose what to include and who can see it, and a teammate continues it in whichever tool they use. Secrets are removed on your machine before anything is uploaded.

```
Alice (Claude Code):  /share
Bob   (OpenCode):     /pickup alice's webhook retry work
```

## How it works

- **`relay` CLI** reads sessions from each tool, turns them into one common format, removes secrets, and uploads them.
- **`relay mcp`** is an MCP server that all three agents connect to: `list_sessions`, `search_sessions`, `get_session`, `share_current_session`.
- **Server** (Hono + Postgres, Docker) stores shares, enforces org and per-person visibility, search, retention, audit log.
- **Web app** (served by the server at `/`) to browse, search and read sessions, and to add teammates.

| Tool | How sessions are read |
|---|---|
| Claude Code | `~/.claude/projects/<cwd>/*.jsonl` (only conversation entries; injected context is skipped) |
| OpenCode | `opencode session list` and `opencode export` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` (user and agent events, tool calls) |

## Self-host the server

```sh
cp deploy/.env.example deploy/.env        # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build

# first run only: create the org, its owner and a token (printed once)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec server \
  node packages/server/dist/bootstrap.js --org "Your Team" --email you@example.com --name "Your Name"
```

Put a reverse proxy with TLS (Caddy, nginx) in front of `SERVER_PORT`. Open `PUBLIC_URL` in a browser and sign in with your token.

For production, use the `deploy` branch: merging into it tests, builds, backs up, deploys and health-checks automatically, with rollback. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Set up each laptop

```sh
npm install -g @session-relay/cli        # or: npm install && npm run build, then use node packages/cli/dist/index.js
relay login --server https://relay.example.com --token srk_...
relay setup                              # adds the MCP server + /share and /pickup to Claude Code, OpenCode, Codex
```

Admins add teammates with `relay invite bob@example.com --name Bob` (or from the web app's Members page). It prints the `relay login` command to send them.

## Use it

In your agent:

- `/share` writes a handoff summary and shares this session. Add instructions: `/share only Bob`, `/share full transcript`.
- `/pickup <what or whose>` finds a shared session, reads it, checks the code and continues.

From a terminal, inside the repo:

| Command | |
|---|---|
| `relay sessions` | Your local sessions for this repo, across tools |
| `relay share` | Pick a session, choose what to include and who sees it |
| `relay share --latest --tool claude --yes` | Non-interactive |
| `relay share --dry-run` | Write what would be uploaded to `.relay/` and stop |
| `relay list` / `relay list --all` | Shared sessions for this repo / all repos |
| `relay search "idempotency"` | Full-text search |
| `relay show <id>` | Print a handoff |
| `relay pull <id> [--full]` | Write `.relay/handoff-<id>.md` for your agent to read |
| `relay delete <id>` | Delete your share (admins can delete any) |
| `relay members`, `relay invite` | People in your org |

What goes up by default: an agent-written summary (or the first request and last answer), the last 30 messages, and the files touched. Tool calls are reduced to one line each (`edited src/a.ts`, ``ran `npm test` → 3 passed``). `.relay/` ignores itself in git.

## Privacy

- Nothing is uploaded unless you share it.
- Redaction runs locally: private keys, AWS/GitHub/OpenAI/Anthropic/Stripe/Slack/Google keys, JWTs, bearer tokens, passwords in URLs, `*_SECRET=`/`*_TOKEN=` assignments, plus org-defined patterns.
- Shares expire after the org's retention period (90 days by default). Optional repo allowlist per org.
- Every share, pull and delete is in the audit log.

## Develop

Work on `feature/*` branches, open PRs to `main`, release with `scripts/release.sh` (PR `main` → `deploy`).


```sh
npm install
npm run dev:all             # Postgres (Docker) + API on :8787 + web on :5173
npm run bootstrap:dev -- --org Dev --email you@example.com --name You
npm test                    # unit tests
npm run test:integration    # API against a throwaway Postgres
npm run test:e2e -- <repo>  # full stack: 3 users, real sessions from <repo>, MCP client
```

## Multi-tenant by design

Self-hosted installs run one org, but nothing assumes that, so a hosted version needs no rewrite. Every tenant table has `org_id`; tokens and roles are per org; the CLI takes any server URL; transcripts go through a storage interface keyed by org; settings are per org; usage events are recorded per org. Signup, billing and SSO are not built yet.
