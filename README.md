# Session Relay

**Pick up where your teammate left off.** Share coding-agent sessions across **Claude Code**, **Codex**, **OpenCode**, **Gemini CLI**, **Copilot CLI**, **Cursor** and **ZCode**. Your teammate continues in whichever tool they use, with the goal, decisions, next steps and recent conversation.

```
You (Claude Code):      /share
Teammate (OpenCode):    /pickup your webhook retry work
```

![A shared session in the Session Relay web app](docs/images/session.png)

## Why

Handing off agent work means copy-pasting chat logs, or the next person starting from zero. With Session Relay:

- **`/share`**: the agent writes a handoff (goal, decisions, done, next steps, open questions) and shares it with the recent conversation and the files touched.
- **`/pickup`**: the next person's agent finds it, reads it, checks the code and continues, in any of the supported agents.
- **Handoff chains**: work picked up and shared again is linked, so every session shows who started it and who continued it.
- **Handoffs for someone**: share "for Akshat" and it's first in their `/pickup`. Edit a share any time (next steps, title, who it's for).
- **Auto-share drafts** (opt-in): every Claude Code, Gemini CLI and Copilot CLI session is saved as a private draft when it ends; publish it when it's ready.
- **Diff snapshots**: attach your uncommitted changes to a share; the next person `git apply`s them.
- **Handoff templates**: admins decide what a handoff must include per repo ("Tests run", "Migration notes") in a guided editor with ready-made sections and a preview; `/share` follows it.
- **Comments**: teammates leave notes on a session; the agent that picks it up reads them.
- **Linked to PRs and files**: shares carry the branch's pull request; find every session that touched a file with `file:src/billing.ts`.
- **Web app**: browse, search and read everything your team has shared (All, For me, Shared by me, My drafts), plus an **Activity** digest, team **Stats** and Settings in simple tabs. Light and dark, works on phones.
- **Export and audit**: download any session as Markdown or JSON; admins see an audit log of everything.
- **Easy onboarding**: invite links, and `relay login` signs in through the browser.
- **Search everything**: titles, summaries and full transcripts; filter by file, branch, agent, person.
- **Private by default**: nothing is uploaded unless you share it, secrets are removed on your laptop first (test your own patterns in Settings → Privacy), and shares can be limited to specific people.

All of it: [Features](docs/features.md).

## Hosting

| | |
|---|---|
| **Self-hosted** · available now | One `docker compose up` on your own server → [Self-hosting guide](docs/self-hosting.md). Or on your own Cloudflare account with no server to run → [Deploy to Cloudflare](docs/cloudflare.md). Your data stays with you. |
| **Cloud** · coming soon | We run it for you: sign in with GitHub, invite your team, no server. → [Roadmap](docs/roadmap.md) |

The CLI is on npm: [`session-relay`](https://www.npmjs.com/package/session-relay).

## Quick start

**Run the server** (once per team):

```sh
git clone https://github.com/Ryrahul/session-relay.git && cd session-relay
cp deploy/.env.example deploy/.env          # set POSTGRES_PASSWORD, PUBLIC_URL, DOMAIN
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs server | grep -A2 "setup code"
```

Open your server's URL, enter the setup code, and create your organization. You're the owner.

**Connect each laptop:**

```sh
npm install -g session-relay
relay login --server https://relay.your-team.com    # approve in the browser
relay setup        # adds /share and /pickup to every agent you have installed
```

Full walkthrough: [Getting started](docs/getting-started.md).

## Docs

Online at **https://relay.rahulweb.online**. Sources are in [`docs/`](docs/).


- [Getting started](docs/getting-started.md): laptop setup, sharing, picking up
- [Features](docs/features.md): everything it does, in one list
- [Self-hosting](docs/self-hosting.md): Docker, HTTPS, backups, upgrades
- [Deploy to Cloudflare](docs/cloudflare.md): Workers, Hyperdrive, R2, no server
- [Agents](docs/agents.md): how each agent connects, manual setup, MCP tools
- [CLI reference](docs/cli.md)
- [Security & privacy](docs/security.md): what's uploaded, redaction, permissions
- [FAQ](docs/faq.md)
- [Roadmap](docs/roadmap.md)

## How it works

```
 Claude Code ─┐
 Codex       ─┤                         ┌─ web app (browse, search, read, edit)
 OpenCode    ─┤                         │
 Gemini CLI  ─┼─ relay CLI / relay mcp ─┼─ Relay server (Hono + Postgres)
 Copilot CLI ─┤   read · redact · share │
 Cursor      ─┤                         └─ your team's agents via MCP
 ZCode       ─┘
```

| Package | |
|---|---|
| `packages/cli` | `relay` CLI and MCP server: adapters for each agent, redaction, share building |
| `packages/server` | API: orgs, members, invites, tokens, sessions, search, retention, audit. Runs on Node (Docker) or Cloudflare Workers |
| `packages/web` | Web app (React), served by the server or Workers Static Assets |
| `packages/shared` | Session format and API types |

## Development

```sh
npm install
npm run dev:all             # Postgres in Docker + API on :8787 + web on :5173
npm run bootstrap:dev -- --org Dev --email you@example.com --name You
npm test                    # unit tests
npm run test:integration    # API against a throwaway Postgres
npm run test:e2e -- <repo>  # full stack, real agent sessions from <repo>, MCP client
```

Work on `feature/*` branches with PRs to `main`. Releases go `main` → `deploy`; see [deploy-pipeline.md](docs/deploy-pipeline.md).

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host Session Relay freely; if you run a modified version as a service for others, you must publish your changes under the same license.
