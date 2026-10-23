# Roadmap

## Available now: self-hosted

- Share and pick up sessions across **Claude Code**, **OpenCode** and **Codex**:
  - `/share` and `/pickup` in each agent, through the relay MCP server
  - the `relay` CLI for terminals and scripts
- Local secret redaction, plus per-org patterns.
- Per-person visibility, roles, personal tokens, retention, repo allowlist, audit log.
- Web app: browse, search, read, members, settings.
- One-command Docker deployment with automatic HTTPS (Caddy).

## Next

- **npm package** for the CLI (`npm install -g`), instead of installing from source.
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

## Built so far

| Area | Status |
|---|---|
| Adapters (Claude Code, OpenCode, Codex) | Done; Claude Code and OpenCode tested on real sessions |
| Redaction | Done |
| API, auth, roles, visibility, retention, audit | Done; integration-tested against Postgres, including org isolation |
| CLI and MCP server | Done; end-to-end tested with three users |
| Web app | Done; browser-tested flows, light/dark, mobile |
| Self-hosting (Docker, Caddy) | Done |
| CI/CD (deploy branch, rehearsal, backup, rollback) | Done; see [deploy-pipeline.md](deploy-pipeline.md) |
| Signup, OAuth, billing | Not started (cloud) |
