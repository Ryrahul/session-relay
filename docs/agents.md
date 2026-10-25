# Agents

Session Relay works with **Claude Code**, **Codex**, **OpenCode**, **Gemini CLI**, **Copilot CLI**, **Cursor** and **ZCode** (Cursor is experimental). Each one gets the same two things:

1. **The relay MCP server** (`relay mcp`), which gives the agent fifteen tools:

   | Tool | What it does |
   |---|---|
   | `list_sessions` | Shared sessions for the current repo (or all repos), newest first. `for_me` lists handoffs assigned to you; `file` filters by touched file |
   | `search_sessions` | Full-text search over titles, summaries and conversations. The query can include `file:` and `branch:` |
   | `get_session` | A session as a handoff: goal, decisions, done, next steps, open questions, files, conversation. `mode`: `tail` (default), `summary`, or `full` (paged) |
   | `share_current_session` | Shares the session the agent is in, with a summary the agent writes (plus the template's `sections`). Refuses while required template sections are empty, unless `ignore_template`. `include_diff` attaches uncommitted changes. `for` assigns it to a teammate; the branch's PR is attached |
   | `get_session_diff` | The uncommitted changes attached to a session, as a patch |
   | `share_template` | The repo's handoff template: extra sections and instructions. `/share` calls it first |
   | `team_activity` | What the team did in the last day(s): new shares by repo, handoffs for you, pickups, comments |
   | `comment_on_session` | Leaves a note on a session: a question, a finding, "picked this up". `get_session` shows comments before the conversation |
   | `update_session` | Changes a share: title, summary, extra next steps, who it's for, PR, visibility. `publish` shares a draft |
   | `start_live`, `live_status`, `send_live_message`, `check_live_inbox`, `update_live`, `stop_live` | [Working live](live.md): go live, see who else is, message their sessions, take messages |

2. **Three commands**:
   - `/share [instructions]`: write a handoff and share this session. "for Akshat" makes it a handoff for them.
   - `/pickup [what or whose]`: find a shared session, read it, check the code and continue. With nothing after it, handoffs for you come first.
   - `/live [with someone | who | stop | auto on]`: work live with teammates at the same time; their messages reach your agent between steps ([Working live](live.md)).

`relay setup` installs all of these for every agent it finds. Restart your agents afterwards. Add `--live on` for the hooks that bring live messages into Claude Code and Gemini CLI automatically.

```sh
relay setup                         # all installed agents, for your user
relay setup --tools claude,opencode # only some
relay setup --scope project         # write config into the current repo instead
```

## Added an agent later?

`relay setup` only connects agents that are installed when you run it. After installing a new one, connect just that agent:

```sh
relay setup --tools gemini          # one agent
relay setup --tools cursor,copilot  # a few
```

Agent names: `claude`, `codex`, `opencode`, `gemini`, `copilot`, `cursor`, `zcode`. Running `relay setup` again with no `--tools` is also fine: it only adds or replaces the relay entries and leaves your other settings alone. Add `--auto-share on` if you use auto-share drafts. Restart the agent afterwards.

## How sessions are read

| Agent | Where sessions come from | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/<folder>/*.jsonl` | Only conversation entries are read. System prompts and injected context are skipped |
| OpenCode | `opencode session list` and `opencode export` | Uses OpenCode's own commands, not its database files |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | The user and agent message events, plus tool calls |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.jsonl` (or `$GEMINI_CLI_HOME/.gemini`) | Matched to the repo by the folder's `.project_root`. Replays rewinds and edits the way Gemini CLI does. Gemini deletes sessions after 30 days by default |
| Copilot CLI | `~/.copilot/session-state/<id>/events.jsonl` (or `$COPILOT_HOME`) | Matched by the working directory in the session's start event; title from `workspace.yaml` |
| Cursor (experimental) | `~/.cursor/projects/<folder>/agent-transcripts/` | The agent transcripts Cursor's CLI and editor agent write. They have no tool results or per-message times, so tool lines say what was done but not the outcome. Editor chats that aren't agent sessions aren't read |
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

**Gemini CLI**: `~/.gemini/settings.json` or `.gemini/settings.json` in a repo:

```json
{ "mcpServers": { "relay": { "command": "relay", "args": ["mcp"] } } }
```

Commands are TOML: `~/.gemini/commands/share.toml` and `pickup.toml` (`description`, `prompt`; `{{args}}` is what you type after the command).

**Copilot CLI**: `~/.copilot/mcp-config.json`:

```json
{ "mcpServers": { "relay": { "type": "local", "command": "relay", "args": ["mcp"], "tools": ["*"] } } }
```

Copilot's slash commands are skills: `~/.copilot/skills/share/SKILL.md` and `pickup/SKILL.md`.

**Cursor**: `~/.cursor/mcp.json` or `.cursor/mcp.json`:

```json
{ "mcpServers": { "relay": { "type": "stdio", "command": "relay", "args": ["mcp"] } } }
```

Commands go in `~/.cursor/commands/share.md` and `pickup.md`.

The command files `relay setup` writes are in [`packages/cli/src/commands/setup.ts`](../packages/cli/src/commands/setup.ts) (`SHARE_PROMPT`, `PICKUP_PROMPT`). Copy them if you set things up by hand.

## Handoff templates

Admins can ask for more than the standard summary in some repos: **Settings → Handoff templates** in the web app.

1. Click **Start from an example** (Tests run, required, and Rollout notes) or **Blank template**.
2. **Applies to**: `github.com/acme/api` (one repo), `github.com/acme/*` (everything from an owner), or `*` (all). Click a suggestion under the box to fill it in. The editor lists which of your repos the template is used for; the most specific match wins.
3. **Sections**: a name, an optional hint for the agent ("what to write"), and a **Required** switch. Add ready-made ones with one click (Tests run, Rollout notes, Migration notes, Risks, How to verify, Follow-up tickets), and reorder with the arrows.
4. **Extra instructions** (optional), e.g. "Mention any feature flags you touched".
5. Open **Preview what the agent is told** to check the wording, then **Save templates** in the bar at the bottom (or **Discard**). Saving is blocked, with a message, if two templates use the same repos or a section appears twice.

Members see the templates read-only on the same tab.

`/share` calls `share_template` first and fills the sections in. If a required one is empty, the agent is told what's missing and tries again (it can pass `ignore_template` when a section doesn't apply). `relay share` from a terminal shares anyway and prints a note; add sections later with `relay edit <id> --section "Tests run=npm test passes"` or **Edit** in the web app, which flags shares that are missing required sections. `relay template` shows the template for the current repo.

## Auto-share drafts

```sh
relay setup --auto-share on     # off to remove
```

This adds a session-end hook to each supported agent that's installed:

| Agent | Hook |
|---|---|
| Claude Code | `SessionEnd` in `~/.claude/settings.json` |
| Gemini CLI | `SessionEnd` in `~/.gemini/settings.json` |
| Copilot CLI | `sessionEnd` in `~/.copilot/hooks/relay.json` |

Codex, OpenCode, Cursor and ZCode don't get a hook yet; use `/share` there. When a session ends, in a git repo, with at least 4 messages, it's saved as a **private draft**: only you can see it, it doesn't count in Activity or Stats, and it follows the org's retention. If you end the same session again, the old draft is replaced; if you already shared it, nothing happens.

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
| Gemini CLI | Session reading tested against fixtures built from its record types (rewind, patch, re-appended messages), setup and hook checked end to end; live run pending |
| Copilot CLI | Session reading tested against fixtures built from the SDK's event types, setup and hook checked end to end; live run pending |
| Cursor | Experimental: transcript reading tested against a documented sample; live run pending |
| Codex 0.145 | Session reading tested against the rollout format; full live run pending |
| ZCode | Session reading tested against ZCode's own session tables; `relay setup` config checked against its config schema; live run pending |
