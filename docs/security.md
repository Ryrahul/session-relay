# Security & privacy

## What leaves your laptop

**Nothing, unless you share it.** There is no background sync. A share happens only when:
- you run `/share` in an agent,
- you run `relay share`, or
- an agent calls `share_current_session` because you asked it to.

A share contains:

| | Default (`summary+tail`) | `summary` | `full` |
|---|---|---|---|
| Summary (goal, decisions, done, next, open questions) | ✓ | ✓ | ✓ |
| Repo, branch, commit, title, files touched | ✓ | ✓ | ✓ |
| Last 30 messages | ✓ | | ✓ |
| Every message | | | ✓ |

Messages are your prompts, the agent's replies, and **one line per tool call**, such as ``ran `npm test` → 3 passed`` or `edited src/a.ts`.

These are **never** uploaded:
- file contents read by tools
- full command output
- system prompts or injected context
- reasoning

Paths inside the repo are made relative (`src/a.ts`, not `/Users/you/project/src/a.ts`). Paths outside the repo that appear in messages are left as they are.

Preview a share before sending it: `relay share --dry-run` writes the exact payload to `.relay/`.

## Secret redaction

Every message and summary passes through a redactor **on your machine** before upload. It replaces matches with `[REDACTED:<kind>]`:

- private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- AWS access keys
- GitHub tokens (`ghp_`, `gho_`, `github_pat_`, …)
- Anthropic and OpenAI keys
- Stripe secret and restricted keys
- Slack tokens
- Google API keys
- JWTs
- `Bearer` / `Basic` credentials
- passwords inside URLs (`postgres://user:****@host`)
- env-style assignments: `*_SECRET=`, `*_TOKEN=`, `*_PASSWORD=`, `*_API_KEY=`, …
- quoted values of keys named like secrets: `"apiKey": "..."`
- Session Relay tokens (`srk_…`)
- **your org's own patterns**, set by admins in **Settings → Extra secret patterns**

The number of redactions is shown when you share and on the session page. Redaction is a safety net, not a guarantee. Don't paste secrets into agent sessions you plan to share.

## Who can see a share

- Sessions belong to your **org**. Nobody outside it can list, read or even confirm that a session exists. That's enforced on every query and covered by tests.
- Inside the org, a share is visible to **everyone** (default) or only to **selected people** (`/share only Bob`, `--people`).
- The author or an org admin can change or delete a share.

| Role | Can |
|---|---|
| Member | Share; read what's visible to them; delete their own shares; manage their own tokens |
| Admin | Also: add and remove members, delete any share, change org settings |
| Owner | Also: add owners and admins, remove admins |

## Invite links and browser login

- An invite link contains a random secret; the server stores only its hash. A link works **once**, can be revoked, and expires after 1, 7 or 30 days. Only admins can create links, and only owners can create owner links.
- `relay login` (browser) creates a short code that expires in 10 minutes. A signed-in user approves it in the web app, which shows the computer's name and the code to compare. The CLI's token is created only then, for the approving user in their current org, and is handed to the CLI once. A denied code can't be approved later.
- The unauthenticated endpoints (`/v1/join`, `/v1/auth/device`) are rate-limited per IP.

## Tokens

- Tokens are personal, one person in one org, and start with `srk_`.
- The server stores only a SHA-256 hash. A token is shown once, when it's created.
- Create one per laptop and revoke a lost one in **Settings → Your tokens**.
- Removing a member revokes all their tokens immediately.

## Retention and deletion

- Shares expire after the org's retention period (default **90 days**; set in **Settings**). Expired shares and their transcripts are deleted by the server automatically.
- Deleting a share removes its messages and transcript immediately. Handoff files already pulled to someone's laptop are not recalled.

## Audit and usage

Every share, pull, delete, invite, token change and settings change is recorded in an audit log, with who did it and when. Admin access to it in the web app is planned; it is in the `audit_log` table today.

## Self-hosted data

On a self-hosted server, all data stays on your machine, in Postgres and a Docker volume. Session Relay makes no outbound calls: no telemetry, and the web app bundles its own fonts.

## Reporting a vulnerability

Please open a private security advisory on GitHub (**Security → Report a vulnerability**) instead of a public issue.
