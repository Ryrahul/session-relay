# Features

Everything Session Relay does today. Each item links to where it's explained in detail.

## Sharing and picking up

| Feature | What it does |
|---|---|
| **`/share` and `/pickup`** | Commands in **Claude Code**, **Codex**, **OpenCode**, **Gemini CLI**, **Copilot CLI**, **Cursor** and **ZCode**. `/share` has the agent write a handoff (goal, decisions, done, next steps, open questions) and share it with the recent conversation and the files touched. `/pickup` finds a session, reads it, checks the code and continues. [Getting started](getting-started.md) |
| **Works across agents** | Share from one agent, pick up in another. Each agent's sessions are read in its own format and turned into one handoff. [Agents](agents.md) |
| **What to include** | Summary only, summary plus the last 30 messages (default), or the full transcript. |
| **Handoff chains** | A share made after `/pickup` links to the session it continues. Every session shows who started the work and who continued it. [Agents](agents.md#handoff-chains) |
| **Handoffs for someone** | `/share for Akshat`, `relay share --for akshat`, or **For** in the web app. It shows as **For you** in their list, and `/pickup` with no request checks their handoffs first. They can see it even if the share is private. |
| **Edit after sharing** | Fix the title, goal, next steps, decisions or who it's for, in the web app (**Edit**), with `relay edit`, or by asking your agent (`update_session`). Only the author or an admin can edit. |
| **Diff snapshot** (opt-in) | `relay share --diff` or "/share with the diff" attaches your uncommitted changes (tracked changes and new files, redacted, up to 500 KB). The web app shows them file by file; `relay pull` writes a `.patch` your teammate can `git apply`; agents fetch it with `get_session_diff`. |
| **Pull request links** | `relay share` attaches the current branch's open PR (found with the GitHub CLI), or pass `--pr <url>`. The session shows the PR, and `relay pr-comment <id>` posts a link to the session on the PR. |
| **Handoff templates** | Admins decide what a handoff must include, per repo (`github.com/acme/*`, an exact repo, or `*`): extra sections like "Tests run" or "Migration notes", each with a hint and optionally required, plus instructions for the agent. `/share` follows it (the agent can't share until required sections are filled, unless they don't apply); the CLI warns; the web app flags missing sections and lets you fill them in. Set up in **Settings → Handoff templates**: start from an example, pick repos, add ready-made sections with one click, preview what the agent is told. `relay template` shows a repo's template. [How](agents.md#handoff-templates) |
| **Comments** | Leave a note on any session you can see: in the web app, with `relay comment <id> "…"`, or from your agent (`comment_on_session`). The agent that picks the session up reads them first. Secrets are removed from comments too. |
| **Auto-share drafts** (opt-in) | `relay setup --auto-share on` saves every Claude Code, Gemini CLI and Copilot CLI session as a **private draft** when it ends (in a git repo, 4+ messages). Only you see drafts (**My drafts**, `relay list --drafts`). Publish one when it's ready: **Publish to team** in the web app, `relay publish <id>`, or ask your agent. Sessions you already shared are skipped. |
| **Without MCP** | `relay pull <id>` writes a handoff file any agent can read. |

## Finding sessions

| Feature | What it does |
|---|---|
| **Search** | Full-text search over titles, summaries, conversations and **full transcripts** (results say "matched in the full transcript"), in the web app, the CLI (`relay search`) and from your agent. |
| **Filters** | By repo, branch, agent, author, who it's for, and **touched file**: `relay list --file billing/invoice.ts`, or type `file:invoice.ts branch:main` in any search box. |
| **Activity (digest)** | What the team did in the last day, week or month: new shares by repo, handoffs for you, who picked up what, and new comments. In the web app (**Activity**), with `relay digest`, or ask your agent ("what did the team do today?" → `team_activity`). |
| **Stats** | Shares, pickups, continued handoffs, comments and active people per period; shares per day; by person, agent and repo. **Stats** in the web app, or `relay stats`. |
| **Export** | Download a session as Markdown or JSON (full transcript included) from its page or with `relay export <id>`. Export a repo or everything you can see as NDJSON from **Settings → Export** or `relay export [--all] [--full]`. |
| **Web app** | Browse by day with **All / For me / Shared by me / My drafts** views, read the full conversation with tool calls folded, copy the `/pickup` command. Settings in tabs (General, Privacy, Handoff templates, Tokens, Export). Light and dark mode, works on phones. |

## Privacy and control

| Feature | What it does |
|---|---|
| **Nothing uploads unless you share** | Sessions stay on your laptop until you run `/share` or `relay share`. |
| **Secret redaction on your laptop** | API keys, tokens, passwords and private keys are removed before upload. Admins can add their own patterns and **test them on sample text** in **Settings → Privacy** before saving. `relay share --dry-run` lists every redaction with the text around it, and writes exactly what would be sent. [Security](security.md) |
| **Visibility** | The whole team, or only the people you choose. |
| **Retention** | Shares expire after the org's retention period (default 90 days) and are deleted, transcripts included. |
| **Repo allowlist** | Admins can limit which repositories can be shared. |
| **Audit log** | Every share, view, pickup, edit, comment, export, delete, invite, token and settings change is recorded. Admins see it on the **Audit log** page (filter by action and person) or with `relay audit`. |

## Teams

| Feature | What it does |
|---|---|
| **Organizations and roles** | Owner, admin and member. Every record belongs to one organization. |
| **First-run setup** | A fresh server shows a setup page: enter the one-time code and create your organization. [Self-hosting](self-hosting.md) |
| **Invite links** | Single-use, expiring, revocable links. The new member picks their name and is signed in. |
| **Browser login** | `relay login --server …` opens the browser; approve the code and the CLI is signed in. |
| **Personal tokens** | One per laptop or script, each revocable in **Settings → Tokens**. |

## Running it

| Option | |
|---|---|
| **Docker** | One `docker compose up` with Postgres and automatic HTTPS, or behind your own nginx. [Self-hosting](self-hosting.md) |
| **Cloudflare Workers** | No server: Workers + Hyperdrive (Postgres) + R2 + a Cron Trigger. [Deploy to Cloudflare](cloudflare.md) |
| **Continuous deployment** | Optional pipeline: test, migrate, deploy, health check, roll back. [Continuous deployment](deploy-pipeline.md) |
| **Cloud** | Coming soon. [Roadmap](roadmap.md) |
