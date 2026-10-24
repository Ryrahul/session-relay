# Getting started

Session Relay lets your team hand coding-agent sessions to each other. You share a session from Claude Code, OpenCode, Codex or ZCode. A teammate picks it up in whichever of those they use. Their agent reads the goal, the decisions, the next steps and the recent conversation, checks the code, and carries on.

```
You (Claude Code):       /share
Teammate (OpenCode):     /pickup your webhook retry work
```

You need:

- A Session Relay server for your team. Someone sets this up once; see [Self-hosting](self-hosting.md). Cloud hosting is coming soon.
- Node.js 20 or newer on your laptop.
- An invite link from an admin (web app → **Members → Invite with a link**). Opening it creates your account and signs you in.

## 1. Install the CLI

```sh
npm install -g session-relay
relay --version
```

Update later with `npm install -g session-relay@latest`. Without a global install, `npx session-relay <command>` works too.

<details><summary>Install from source instead</summary>

```sh
git clone https://github.com/Ryrahul/session-relay.git ~/.session-relay
cd ~/.session-relay && npm ci && npm run build
npm link -w session-relay
```
</details>

## 2. Log in

```sh
relay login --server https://relay.your-team.com
```

It opens the site in your browser and shows a code like `KDQX-7MRA`. Check the browser shows the same code, click **Approve**, and the CLI is signed in. On a machine without a browser, it prints the link to open anywhere you're signed in; or create a token in **Settings** and use `relay login --server … --token srk_…`.

The CLI's token is saved in `~/.config/session-relay/config.json`, readable only by you. It appears in **Settings → Your tokens** as `CLI · you@your-machine`, so you can revoke a lost laptop.

## 3. Connect your agents

```sh
relay setup
```

Optional: `relay setup --auto-share on` saves every Claude Code session as a private draft when it ends, so you can publish it later without remembering to `/share` ([details](agents.md#auto-share-drafts-claude-code)).

This adds the relay MCP server and two commands, `/share` and `/pickup`, to each agent that is installed: Claude Code, OpenCode, Codex and ZCode. Restart your agents afterwards. Details and manual setup are in [Agents](agents.md).

## 4. Share a session

At a good stopping point, in your agent:

```
/share
```

The agent writes a handoff:

- **Goal:** what you're trying to do.
- **Decisions:** what was decided and why.
- **Done:** what's finished.
- **Next steps:** concrete things to do next.
- **Open questions:** anything unresolved.

It then shares the session together with the last 30 messages and the list of files touched. You get back an id like `rs_7KQ2M9XA`.

You can add instructions:

```
/share only Bob
/share for Akshat              # a handoff for them: first in their /pickup
/share full transcript
/share title: payment retry, half done
```

If your branch has an open pull request (and the GitHub CLI `gh` is installed), the share links to it.

Or share from a terminal, inside the repo:

```sh
relay share               # pick a session, choose what to include and who sees it
relay share --dry-run     # see exactly what would be uploaded, upload nothing
relay share --for akshat  # a handoff for someone
```

Changed your mind? Edit a share later in the web app (**Edit** on the session), with `relay edit`, or ask your agent ("add a next step to my last share"):

```sh
relay edit rs_7KQ2M9XA --add-next "load-test the retry path" --for bob
relay pr-comment rs_7KQ2M9XA    # post a link to the session on its pull request
```

Teammates can leave **comments** on a session (web app, `relay comment rs_7KQ2M9XA "…"`, or "comment on Alice's session that…" in an agent). Whoever picks it up next sees them.

## 5. Pick up a session

In your agent:

```
/pickup                        # handoffs for you first
/pickup alice's webhook retry work
/pickup rs_7KQ2M9XA
```

The agent finds the session, reads the handoff, checks the current state of the code, tells you where things stand, and continues.

From a terminal:

```sh
relay list                     # shared sessions for this repo
relay list --for-me            # handoffs for you, any repo
relay search "idempotency"
relay search "file:src/webhooks.ts"   # every session that touched a file
relay pull rs_7KQ2M9XA         # writes .relay/handoff-rs_7KQ2M9XA.md
```

Then tell any agent: *"Read .relay/handoff-rs_7KQ2M9XA.md and continue."*

To catch up on what the team did: `relay digest` (or `--days 7`), the **Activity** page, or ask your agent "what did the team do today?".

## The web app

Open your server's address in a browser and sign in with your token. You can:

- browse, search and read shared sessions, including the full conversation and tool calls
- filter to **For me**, by agent, by repo, or search `file:` and `branch:`
- **Edit** your shares: title, summary, next steps, who it's for, the pull request
- **Comment** on any session you can see
- see **Activity** (what the team shared, picked up and discussed) and **Stats** (who shares and picks up, by agent and repo)
- invite teammates with a link (admins), and create or revoke your own tokens
- if you're an admin, change org settings: retention, allowed repositories, extra secret patterns

**Get started** in the web app shows the commands above with your server's address filled in.

## What gets uploaded

Only what you share. Secrets are removed on your laptop before anything is sent. See [Security & privacy](security.md).
