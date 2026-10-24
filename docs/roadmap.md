# Roadmap

## Available now

**Self-hosted Session Relay**, open source under [AGPL-3.0](https://github.com/Ryrahul/session-relay/blob/main/LICENSE):

- Share and pick up sessions across **Claude Code**, **Codex**, **OpenCode**, **Gemini CLI**, **Copilot CLI**, **Cursor** and **ZCode**:
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
- **Edit after sharing**: title, summary, next steps, who it's for and the PR, in the web app, `relay edit` or the `update_session` MCP tool.
- **Handoffs for someone**: `--for`, `/share for …`; shown as **For you** and checked first by `/pickup`.
- **Pull request links**: the branch's open PR is attached automatically; `relay pr-comment` posts the session on the PR.
- **Search by file and branch**: `file:` and `branch:` in any search, `--file` in the CLI.
- **Comments** on sessions, in the web app, the CLI and from agents; the next agent reads them.
- **Activity digest** and **stats**: web pages, `relay digest`, `relay stats`, and the `team_activity` MCP tool.
- **Diff snapshots**: uncommitted changes attached to a share, viewable in the web app and `git apply`-able after `relay pull`.
- **Handoff templates**: per-repo sections and instructions that `/share` follows; missing sections flagged.
- **Audit log page** (admins) and `relay audit`; **export** of a session (Markdown/JSON) or many (NDJSON).
- **Gemini CLI, Copilot CLI and Cursor** (experimental) adapters, with `relay setup` for each.
- **Auto-share drafts** (opt-in; Claude Code, Gemini CLI, Copilot CLI): sessions saved as private drafts at session end; publish when ready.

## Next

- Live runs of Gemini CLI, Copilot CLI and Cursor with real sessions; Cursor editor chats.
- Prebuilt public Docker image, so self-hosting needs no build.
- Full live test of Codex with a real session fixture.
- S3 / Cloudflare R2 storage for full transcripts.

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
| CLI `0.4.0` on npm | 2026-10-24 | Gemini CLI, Copilot CLI and Cursor (experimental); `relay edit`, `publish`, `comment`, `pr-comment`, `digest`, `stats`; `setup --auto-share`; `--for`, `--pr`, `--for-me`, `--file`, `--drafts`; MCP `update_session`, `comment_on_session`, `team_activity` |
| Server and web app | 2026-10-24 | Edit after sharing, handoffs for someone, PR links, file and branch search, comments, Activity and Stats pages, drafts, new agents (migrations 0006–0009) |
| CLI `0.3.0` on npm | 2026-10-24 | ZCode support |
| CLI `0.2.0` on npm | 2026-10-24 | Handoff chains (`--continues`), browser login, `relay invite --link` |
| Server and web app | 2026-10-24 | Handoff chains, invite links, browser login (migrations 0002, 0003) |
| CLI `0.1.0` on npm | 2026-10-23 | First public release: adapters for all three agents, sharing, MCP server, `relay setup` |
| Server and web app | 2026-10-23 | First production deployment |

## Built so far

| Area | Status |
|---|---|
| Adapters (Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor, ZCode) | Done; Claude Code and OpenCode tested on real sessions, the others on format fixtures |
| Redaction | Done |
| API, auth, roles, visibility, retention, audit | Done; integration-tested against Postgres, including org isolation |
| CLI (npm `session-relay`) and MCP server | Done; published, end-to-end tested with three users |
| Web app | Done; browser-tested flows, light/dark, mobile |
| Handoff chains | Done; integration and end-to-end tested (CLI + MCP) |
| Invite links, browser login | Done; integration and browser tested |
| Edit, assign, PR links, file search | Done; integration, CLI, MCP and browser tested |
| Comments | Done; integration, CLI, MCP and browser tested, with redaction |
| Activity digest, stats | Done; integration, CLI, MCP and browser tested (desktop, phone, light, dark) |
| Auto-share drafts | Done; integration, hook end-to-end (replace, skip shared, bad input), settings unit tests, browser tested |
| Self-hosting (Docker, Caddy or nginx) | Done; running in production |
| Cloudflare Workers | Done; smoke-tested in CI with wrangler dev + Postgres on every PR |
| CI/CD (deploy branch, rehearsal, backup, rollback) | Done; see [deploy-pipeline.md](deploy-pipeline.md) |
| Docs site | Done; https://relay.rahulweb.online |
| Signup, OAuth, billing | Not started (cloud) |
