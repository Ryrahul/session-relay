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
| `--diff` | Attach your uncommitted changes: `git diff HEAD` plus new untracked files (respecting `.gitignore`), redacted, up to 500 KB |
| `--for <name>` | Teammate this handoff is for (name or email). It's first in their `/pickup` and visible to them even if private |
| `--pr <url>` | Pull request it belongs to. Default: the current branch's open PR, found with the GitHub CLI (`gh`). `none` to leave it out |
| `--continues <id>` | Shared session this work continues. Default: the one you last picked up in this repo (within 7 days). `none` to unlink |
| `--summary-file <file>` | JSON `{goal, decisions, done, next, open_questions, sections: [{title, items}]}`. Without it, the summary is the first request and the last answer. If the repo has a handoff template with required sections, `relay share` prints a note when they're missing |
| `--dry-run` | List each redaction (with the text around it) and write what would be uploaded to `.relay/dry-run-*.json`; upload nothing |
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
| `relay search "<query>"` | Full-text search over titles, summaries, messages and full transcripts. Add `file:<path>` or `branch:<name>` to filter |
| `relay template [--repo <repo>]` | The handoff template for this repo: sections a share should include |
| `relay export <id> [--format md\|json] [-o file]` | Download a session, full transcript included |
| `relay export [--repo <repo>\|--all] [--since YYYY-MM-DD] [--full] [-o file]` | Every session of this repo (or all repos) you can see, as NDJSON |
| `relay digest [--days 1]` | What the team did lately: new shares by repo, handoffs for you, pickups, comments |
| `relay stats [--days 30] [--json]` | Shares, pickups, continued handoffs and comments, by day, person, agent and repo |
| `relay show <id>` | Print a session as a handoff |
| `relay pull <id>` | Write `.relay/handoff-<id>.md` for your agent, and `.relay/diff-<id>.patch` if changes were attached (`git apply` it). Counts as a pickup in Activity and Stats |

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
| `relay audit [--action <prefix>] [--user <name>] [--session <id>] [--limit 50]` | Admins: the audit log |
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
| `--section "<title>=<item>"` | Add an item to a section (e.g. one the repo's template asks for); creates the section if needed. Repeatable |
| `--summary-file <file>` | Replace the whole summary with JSON `{goal, decisions, done, next, open_questions, sections}` |
| `--for <name>` | Who it's for; `none` to clear |
| `--pr <url>` | Pull request; `none` to clear |
| `--team` / `--people <names>` | Visible to the whole team, or only these people |

## Working live

See [Working live](live.md).

| Command | |
|---|---|
| `relay live start [--title <text>] [--auto] [--tool <agent>]` | Go live in this repo. `--auto` lets your agent act on teammates' messages without asking |
| `relay live status [--json]` | Who's live, where, on which files (also `relay live who`) |
| `relay live send <name\|everyone\|lv_id> <text> [--question]` | Message a teammate's live session, or everyone live in this repo |
| `relay live reply <number> <text>` | Answer a message |
| `relay live inbox` | Take new messages yourself |
| `relay live watch` | Print messages as they arrive (your agent still gets them) |
| `relay live auto on\|off` | Let your agent act on messages without asking, or not |
| `relay live stop [--all]` | Stop being live (`--all`: every live session on this machine) |

## Agents

| Command | |
|---|---|
| `relay setup [--tools claude,codex,opencode,gemini,copilot,cursor,zcode] [--scope user\|project] [--relay-config <file>]` | Install the MCP server and `/share` `/pickup` into your agents |
| `relay setup --auto-share on\|off` | Save each Claude Code, Gemini CLI and Copilot CLI session as a private draft when it ends (a session-end hook). `off` removes the hooks |
| `relay hook session-end --tool <agent>` | What that hook runs. It never fails the agent; it logs to `hook.log` next to your relay config |
| `relay setup --live on\|off` | Hooks that bring teammates' live messages and file overlap warnings into Claude Code and Gemini CLI between steps ([Working live](live.md)) |
| `relay hook live <prompt\|pre-edit\|post-tool\|stop\|end> --tool <agent>` | What those hooks run. They do nothing unless you're live, and never fail the agent |
| `relay setup --tools <agent>` | Connect one agent you installed later, e.g. `--tools gemini` |
| `relay mcp` | The MCP server on stdio. Your agent starts it; you don't run it yourself |
