# Session Relay plan

Interactive version with the original options: https://claude.ai/artifact/4B8u5LX9hEUk82wCo3UwSt

## Goal

Anyone can say "continue Rahul's webhooks session" in Claude Code, Codex or OpenCode and get the context: goal, decisions, what changed, what's left, and the recent conversation.

## Decisions (locked)

1. **Storage:** self-hosted (Docker + Postgres on our server).
2. **Sharing:** manual only, via `relay share` or `/share`.
3. **Visibility:** whole team by default, can pick people per share.
4. **Default content:** summary + last 30 messages + files touched.
5. **Summary:** written by the agent itself via `/share`.
6. **Continuing:** context via MCP / handoff file now; native same-tool resume later.
7. **Stack:** TypeScript (Node), installed via npm.
8. **Web viewer:** in v1.
9. **Multi-tenant from day one** so it can become a hosted product later. Signup, billing and SSO deferred.

## Architecture

- **Adapters** (CLI): one reader per tool. Each finds sessions for the current repo and converts them to the common format in `packages/shared`.
- **Redactor** (CLI): removes secrets locally before upload.
- **relay CLI:** `login`, `whoami`, `share`, `list`, `search`, `show`, `pull`, `delete`, `mcp`.
- **relay mcp:** the CLI as a local stdio MCP server, used by all three tools.
- **API server:** stores shares, enforces org and visibility rules, search.
- **Blob storage:** full transcripts (local disk, later S3/R2).
- **Web app:** browse and read sessions.

### MCP tools

```
list_sessions(repo?, author?, tool?, limit=10)
search_sessions(query, repo?)
get_session(id, mode = "summary" | "summary+tail" | "full", tail = 30)
share_current_session(summary, include, visibility)
```

## Phases

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Collect real sample sessions per tool/version, confirm formats, save redacted fixtures | 1 day |
| 1 | Adapters, redaction, `relay share --dry-run` | 3 days |
| 2 | Sessions API, visibility, expiry, `share/list/search/show/pull/delete` | 3 days |
| 3 | `relay mcp`, `/share` commands for all three tools, `relay setup` | 2 days |
| 3b | Web app: sign in with token, list, search, read | 2–3 days |
| 4 | Install script, onboarding doc, pilot with 2–3 people | 1–2 days |
| 5 | Optional: auto-share hooks, native resume, semantic search, Slack post | 3–5 days |

## Done in the scaffold

- Monorepo, builds and tests.
- Multi-tenant schema: orgs, users, memberships with roles, hashed API tokens, org settings, sessions, per-person visibility, usage events, audit log.
- Server: health, token auth scoped to org, `GET /v1/me`, migrations on start, bootstrap command.
- Storage interface with local disk driver.
- CLI: `login` (server URL configurable, token stored with 0600), `whoami`, placeholders for the rest.
- Docker Compose for self-hosting.

## Open questions

- License before any outside use.
- Final product name (check npm and domain availability).
