# CLI reference

`relay` runs on your laptop. Commands that read local sessions run **inside a git repo** and look at sessions started in that repo (or its subfolders).

## Account

| Command | |
|---|---|
| `relay login --server <url>` | Connect this machine: approve the code in your browser. `--no-browser` prints the link instead of opening it |
| `relay login --server <url> --token <token>` | Connect with an existing token (scripts, CI, machines without a browser) |
| `relay whoami` | Show your user, org, role and server |

The config is at `~/.config/session-relay/config.json` (mode `600`). Override it with:
- `RELAY_CONFIG=<file>`, or
- `RELAY_SERVER` together with `RELAY_TOKEN`.

## Sharing

| Command | |
|---|---|
| `relay sessions [--tool claude\|codex\|opencode\|gemini\|copilot\|cursor\|zcode]` | Your local agent sessions for this repo, across tools |
| `relay share` | Pick a session, choose what to include and who sees it, confirm |

`relay share` options:

| Flag | |
|---|---|
| `--tool <tool>` | Only sessions from `claude`, `codex`, `opencode`, `gemini`, `copilot`, `cursor` or `zcode` |
| `--id <id>` | A specific session (prefix is fine; see `relay sessions`) |
| `--latest` | The newest session, without asking |
| `--include <mode>` | `summary`, `summary+tail` (default) or `full` |
| `--tail <n>` | Messages to keep with `summary+tail` (default 30) |
| `--title <title>` | Title teammates see |
| `--people <names>` | Comma-separated names or emails. Default: the whole team |
| `--for <name>` | Teammate this handoff is for (name or email). It's first in their `/pickup` and visible to them even if private |
| `--pr <url>` | Pull request it belongs to. Default: the current branch's open PR, found with the GitHub CLI (`gh`). `none` to leave it out |
| `--continues <id>` | Shared session this work continues. Default: the one you last picked up in this repo (within 7 days). `none` to unlink |
| `--summary-file <file>` | JSON `{goal, decisions, done, next, open_questions}`. Without it, the summary is the first request and the last answer |
| `--dry-run` | Write what would be uploaded to `.relay/dry-run-*.json` and stop |
| `-y, --yes` | Don't ask questions |
| `--json` | Print `{id, title, redactions, continues, pr_url}` |

Example for scripts: `relay share --tool claude --latest --yes --json`.

## Reading

| Command | |
|---|---|
| `relay list` | Shared sessions for this repo |
| `relay list --all` | All repos |
| `relay list --for-me` | Handoffs assigned to you, from any repo |
| `relay list --drafts` | Your drafts (saved automatically at session end) |
| `relay search "<query>"` | Full-text search over titles, summaries and messages. Add `file:<path>` or `branch:<name>` to filter |
| `relay digest [--days 1]` | What the team did lately: new shares by repo, handoffs for you, pickups, comments |
| `relay stats [--days 30] [--json]` | Shares, pickups, continued handoffs and comments, by day, person, agent and repo |
| `relay show <id>` | Print a session as a handoff |
| `relay pull <id>` | Write `.relay/handoff-<id>.md` for your agent. Counts as a pickup in Activity and Stats |

`list` and `search` options: `--repo`, `--branch`, `--author <name|email|me>`, `--tool`, `--file <path>` (sessions that touched it; part of the path is fine), `--for-me`, `--limit` (default 20), `--json`.

`show` and `pull` options:
- `--summary-only`: no messages.
- `--full`: the full transcript, when it was shared. `show` prints the first page; `pull` fetches every page.
- `show --tail <n>`: only the last n messages.
- `pull --out <file>`: choose the output file.

## Managing

| Command | |
|---|---|
| `relay publish <id> [--people <names>] [--for <name>]` | Share a draft with the whole team (or only some people) |
| `relay edit <id> …` | Change your share (admins: any share). See below |
| `relay comment <id> "<text>"` | Leave a note on a session. Without text, list its comments. Secrets are removed first |
| `relay pr-comment <id> [--pr <url>]` | Comment on the share's pull request with a link and the next steps (uses `gh`) |
| `relay delete <id> [-y]` | Delete your share. Admins can delete any share |
| `relay members` | People in your org |
| `relay invite --link [--role member\|admin\|owner] [--days 7]` | Admins: create a single-use invite link |
| `relay invite <email> --name <name> [--role member\|admin\|owner]` | Admins: add someone and print their one-time login command |

`relay edit` options:

| Flag | |
|---|---|
| `--title <title>` | New title |
| `--goal <text>` | Replace the goal |
| `--add-next <text>` | Add a next step; repeat for more. `--clear-next` removes the old ones first |
| `--add-done`, `--add-decision`, `--add-question <text>` | Add to those lists (repeatable) |
| `--summary-file <file>` | Replace the whole summary with JSON `{goal, decisions, done, next, open_questions}` |
| `--for <name>` | Who it's for; `none` to clear |
| `--pr <url>` | Pull request; `none` to clear |
| `--team` / `--people <names>` | Visible to the whole team, or only these people |

## Agents

| Command | |
|---|---|
| `relay setup [--tools claude,codex,opencode,gemini,copilot,cursor,zcode] [--scope user\|project] [--relay-config <file>]` | Install the MCP server and `/share` `/pickup` into your agents |
| `relay setup --auto-share on\|off` | Save each Claude Code, Gemini CLI and Copilot CLI session as a private draft when it ends (a session-end hook). `off` removes the hooks |
| `relay hook session-end --tool <agent>` | What that hook runs. It never fails the agent; it logs to `hook.log` next to your relay config |
| `relay mcp` | The MCP server on stdio. Your agent starts it; you don't run it yourself |
