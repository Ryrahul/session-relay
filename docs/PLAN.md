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

## Status (22 Oct 2026)

Phases 0–3b are built and tested locally:

- **Phase 0:** formats checked against real Claude Code 2.1 and OpenCode 1.19 sessions; fixtures in `fixtures/`. Codex 0.145 could not complete a run on the dev laptop (no provider key), so its fixture is constructed from the known rollout format.
- **Phase 1:** adapters for all three tools, redaction, `relay share --dry-run`.
- **Phase 2:** sessions API (share, list, search, get with tail/full paging, update, delete), members, tokens, retention purge, audit and usage; all CLI commands.
- **Phase 3:** `relay mcp` with four tools; `/share` and `/pickup` for Claude Code, OpenCode and Codex; `relay setup`.
- **Phase 3b:** web app served by the server.
- **Tests:** unit tests, API integration tests against Postgres (including org isolation), `scripts/e2e.sh` (Docker stack, three users, real sessions, MCP client), and a manual run where Claude Code shared via `/share` and OpenCode continued it via `/pickup`.

Next: Phase 4 (deploy to our server, publish the CLI, onboard the team).

## Open questions

- License before any outside use.
- Final product name (check npm and domain availability).
- Codex: replace the constructed fixture with a real redacted session once Codex is logged in.
