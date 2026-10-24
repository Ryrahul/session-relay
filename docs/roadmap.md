# Roadmap

## Available now

**Self-hosted Session Relay**, open source under [AGPL-3.0](https://github.com/Ryrahul/session-relay/blob/main/LICENSE):

- Share and pick up sessions across **Claude Code**, **OpenCode** and **Codex**:
  - `/share` and `/pickup` in each agent, through the relay MCP server
  - the `relay` CLI, installed with `npm install -g session-relay`
- Local secret redaction, plus per-org patterns.
- Per-person visibility, roles, personal tokens, retention, repo allowlist, audit log.
- Web app: browse, search, read, members, settings.
- One-command Docker deployment with automatic HTTPS (Caddy), or behind your own nginx.
- **Cloudflare Workers deployment**: the same app on Workers + Hyperdrive + R2, no server to maintain ([guide](cloudflare.md)).
- First-run setup in the browser: a one-time code from the server logs creates your organization and owner account.
- **Handoff chains**: a share made after `/pickup` links to the session it continues; the web app shows the whole trail.
- **Invite links**: single-use, expiring, revocable links instead of pasting tokens.
- **Browser login**: `relay login --server …` signs in by approving a code in the web app.

## Next

- **Edit after sharing**: fix a share's title, summary, next steps and visibility in the web app.
- **GitHub PR link**: comment on a PR with the sessions behind it; link the PR from the session page.
- Prebuilt public Docker image, so self-hosting needs no build.
- Full live test of Codex with a real session fixture.
- S3 / Cloudflare R2 storage for full transcripts.
- Audit log in the web app.
- More agents: Cursor, Gemini CLI, Aider (adapters welcome).

## Cloud hosting (coming soon)

A hosted version, so teams don't need to run a server:

- Sign in with GitHub or Google; `relay login` opens the browser.
- Create a team in a minute and invite people by email.
- The same CLI, agents and web app. Your data is isolated per organization, as it is today.
- Free tier for small teams, paid plans for larger ones.

The codebase is already multi-tenant (every record belongs to an organization), so cloud hosting runs the same code as self-hosting.

## Releases

| Version | Date | |
|---|---|---|
| CLI `0.2.0` on npm | 2026-10-24 | Handoff chains (`--continues`), browser login, `relay invite --link` |
| Server and web app | 2026-10-24 | Handoff chains, invite links, browser login (migrations 0002, 0003) |
| CLI `0.1.0` on npm | 2026-10-23 | First public release: adapters for all three agents, sharing, MCP server, `relay setup` |
| Server and web app | 2026-10-23 | First production deployment |

## Built so far

| Area | Status |
|---|---|
| Adapters (Claude Code, OpenCode, Codex) | Done; Claude Code and OpenCode tested on real sessions |
| Redaction | Done |
| API, auth, roles, visibility, retention, audit | Done; integration-tested against Postgres, including org isolation |
| CLI (npm `session-relay`) and MCP server | Done; published, end-to-end tested with three users |
| Web app | Done; browser-tested flows, light/dark, mobile |
| Handoff chains | Done; integration and end-to-end tested (CLI + MCP) |
| Invite links, browser login | Done; integration and browser tested |
| Self-hosting (Docker, Caddy or nginx) | Done; running in production |
| Cloudflare Workers | Done; smoke-tested in CI with wrangler dev + Postgres on every PR |
| CI/CD (deploy branch, rehearsal, backup, rollback) | Done; see [deploy-pipeline.md](deploy-pipeline.md) |
| Docs site | Done; https://relay.rahulweb.online |
| Signup, OAuth, billing | Not started (cloud) |
