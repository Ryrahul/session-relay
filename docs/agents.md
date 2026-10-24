# Agents

Session Relay works with **Claude Code**, **OpenCode**, **Codex** and **ZCode**. Each one gets the same two things:

1. **The relay MCP server** (`relay mcp`), which gives the agent seven tools:

   | Tool | What it does |
   |---|---|
   | `list_sessions` | Shared sessions for the current repo (or all repos), newest first. `for_me` lists handoffs assigned to you; `file` filters by touched file |
   | `search_sessions` | Full-text search over titles, summaries and conversations. The query can include `file:` and `branch:` |
   | `get_session` | A session as a handoff: goal, decisions, done, next steps, open questions, files, conversation. `mode`: `tail` (default), `summary`, or `full` (paged) |
   | `share_current_session` | Shares the session the agent is in, with a summary the agent writes. `for` assigns it to a teammate; the branch's PR is attached |
   | `team_activity` | What the team did in the last day(s): new shares by repo, handoffs for you, pickups, comments |
   | `comment_on_session` | Leaves a note on a session: a question, a finding, "picked this up". `get_session` shows comments before the conversation |
   | `update_session` | Changes a share: title, summary, extra next steps, who it's for, PR, visibility. `publish` shares a draft |

2. **Two commands**:
   - `/share [instructions]`: write a handoff and share this session. "for Akshat" makes it a handoff for them.
   - `/pickup [what or whose]`: find a shared session, read it, check the code and continue. With nothing after it, handoffs for you come first.

`relay setup` installs both for every agent it finds. Restart your agents afterwards.

```sh
relay setup                         # all installed agents, for your user
relay setup --tools claude,opencode # only some
relay setup --scope project         # write config into the current repo instead
```

## How sessions are read

| Agent | Where sessions come from | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/<folder>/*.jsonl` | Only conversation entries are read. System prompts and injected context are skipped |
| OpenCode | `opencode session list` and `opencode export` | Uses OpenCode's own commands, not its database files |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | The user and agent message events, plus tool calls |
| ZCode | `~/.zcode/cli/db/db.sqlite` (CLI and desktop app) | Opened read-only. Needs Node 22.5+ or the `sqlite3` command (built into macOS). Subagent and archived sessions are skipped |

Tool calls become one line each, so any agent can read them:
- `edited src/webhooks.ts`
- ``ran `npm test` → 15 passed``
- `patched a.ts, b.ts`
- `wrote config.json (failed: permission denied)`

Files only count as "touched" when the write succeeded.

## Manual setup

If you'd rather edit config yourself, the MCP server is just a command: `relay mcp`. If `relay` isn't on your PATH, use `npx -y session-relay mcp`.

**Claude Code**

```sh
claude mcp add --scope user relay -- relay mcp
```

or, per project, in `.mcp.json`:

```json
{ "mcpServers": { "relay": { "command": "relay", "args": ["mcp"] } } }
```

Commands go in `~/.claude/commands/share.md` and `pickup.md`, or `.claude/commands/` in a repo.

**OpenCode**: `~/.config/opencode/opencode.json` or `opencode.json` in a repo:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "relay": { "type": "local", "command": ["relay", "mcp"], "enabled": true } }
}
```

Commands go in `~/.config/opencode/commands/` or `.opencode/commands/`.

**Codex**: `~/.codex/config.toml`:

```toml
[mcp_servers.relay]
command = "relay"
args = ["mcp"]
```

Prompts go in `~/.codex/prompts/share.md` and `pickup.md`.

**ZCode**: `~/.zcode/cli/config.json`, or `.zcode/config.json` in a repo:

```json
{ "mcp": { "servers": { "relay": { "type": "stdio", "command": "relay", "args": ["mcp"] } } } }
```

Commands go in `~/.zcode/commands/` or `.zcode/commands/`. `relay setup` finds ZCode through the `zcode` command or the `~/.zcode` folder, so it works for the desktop app too.

The command files `relay setup` writes are in [`packages/cli/src/commands/setup.ts`](../packages/cli/src/commands/setup.ts) (`SHARE_PROMPT`, `PICKUP_PROMPT`). Copy them if you set things up by hand.

## Auto-share drafts (Claude Code)

```sh
relay setup --auto-share on     # off to remove
```

This adds a `SessionEnd` hook to `~/.claude/settings.json`. When a session ends, in a git repo, with at least 4 messages, it's saved as a **private draft**: only you can see it, it doesn't count in Activity or Stats, and it follows the org's retention. If you end the same session again, the old draft is replaced; if you already shared it, nothing happens.

Publish a draft when it's ready: **Publish to team** on the session in the web app, `relay publish <id>`, or ask your agent ("publish my last draft"; `update_session` with `publish`). The summary of a draft is the first request and the last answer; edit it before publishing if you like. What the hook did is logged in `hook.log` next to your relay config.

## Handoff chains

When you load a session with `/pickup` (or `get_session`, or `relay pull`), Session Relay remembers it for that repo for 7 days. Your next `/share` in that repo is linked to it automatically: the web app shows **Continues Alice's session → picked up by Bob**, and each session lists who continued it.

- `/share` with "this is new work, not a continuation", or `relay share --continues none`, skips the link.
- `relay share --continues rs_…` links to a specific session.
- If the session you picked up has since been deleted, the share still goes through, just without the link.

## Using a different account per project

The MCP server reads the same login as the CLI. To use another account or server for one project, point it at another config file:

```sh
RELAY_CONFIG=~/.config/session-relay/client-x.json relay login --server https://relay.client-x.com --token srk_...
relay setup --scope project --relay-config ~/.config/session-relay/client-x.json
```

## Without MCP

Any agent can use a handoff file:

```sh
relay pull rs_7KQ2M9XA     # writes .relay/handoff-rs_7KQ2M9XA.md
```

Then tell the agent: *"Read .relay/handoff-rs_7KQ2M9XA.md and continue from where it stopped."* The `.relay/` folder ignores itself in git.

## Status

| Agent | Status |
|---|---|
| Claude Code 2.1 | Tested end to end: real sessions, `/share` via MCP |
| OpenCode 1.19 | Tested end to end: real sessions, `/pickup` via MCP continued a Claude Code session |
| Codex 0.145 | Session reading tested against the rollout format; full live run pending |
| ZCode | Session reading tested against ZCode's own session tables; `relay setup` config checked against its config schema; live run pending |
