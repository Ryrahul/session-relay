# Getting started

Session Relay lets your team hand coding-agent sessions to each other. You share a session from Claude Code, OpenCode or Codex. A teammate picks it up in whichever of those they use. Their agent reads the goal, the decisions, the next steps and the recent conversation, checks the code, and carries on.

```
You (Claude Code):       /share
Teammate (OpenCode):     /pickup your webhook retry work
```

You need:

- A Session Relay server for your team. Someone sets this up once; see [Self-hosting](self-hosting.md). Cloud hosting is coming soon.
- Node.js 20 or newer, and git, on your laptop.
- A personal token. An admin creates it for you (web app → **Members**, or `relay invite`).

## 1. Install the CLI

The npm package is coming soon. Until then, install from source:

```sh
git clone https://github.com/Ryrahul/session-relay.git ~/.session-relay
cd ~/.session-relay && npm ci && npm run build
npm link -w @session-relay/cli
relay --version
```

To update later: `cd ~/.session-relay && git pull && npm ci && npm run build`.

## 2. Log in

```sh
relay login --server https://relay.your-team.com --token srk_...
relay whoami
```

The token is saved in `~/.config/session-relay/config.json`, readable only by you.

## 3. Connect your agents

```sh
relay setup
```

This adds the relay MCP server and two commands, `/share` and `/pickup`, to each agent that is installed: Claude Code, OpenCode and Codex. Restart your agents afterwards. Details and manual setup are in [Agents](agents.md).

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
/share full transcript
/share title: payment retry, half done
```

Or share from a terminal, inside the repo:

```sh
relay share               # pick a session, choose what to include and who sees it
relay share --dry-run     # see exactly what would be uploaded, upload nothing
```

## 5. Pick up a session

In your agent:

```
/pickup alice's webhook retry work
/pickup rs_7KQ2M9XA
```

The agent finds the session, reads the handoff, checks the current state of the code, tells you where things stand, and continues.

From a terminal:

```sh
relay list                     # shared sessions for this repo
relay search "idempotency"
relay pull rs_7KQ2M9XA         # writes .relay/handoff-rs_7KQ2M9XA.md
```

Then tell any agent: *"Read .relay/handoff-rs_7KQ2M9XA.md and continue."*

## The web app

Open your server's address in a browser and sign in with your token. You can:

- browse, search and read shared sessions, including the full conversation and tool calls
- add teammates and create or revoke your own tokens
- if you're an admin, change org settings: retention, allowed repositories, extra secret patterns

**Get started** in the web app shows the commands above with your server's address filled in.

## What gets uploaded

Only what you share. Secrets are removed on your laptop before anything is sent. See [Security & privacy](security.md).
