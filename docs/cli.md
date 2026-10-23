# CLI reference

`relay` runs on your laptop. Commands that read local sessions run **inside a git repo** and look at sessions started in that repo (or its subfolders).

## Account

| Command | |
|---|---|
| `relay login --server <url> --token <token>` | Connect this machine to a server. Checks the token before saving it |
| `relay whoami` | Show your user, org, role and server |

The config is at `~/.config/session-relay/config.json` (mode `600`). Override it with:
- `RELAY_CONFIG=<file>`, or
- `RELAY_SERVER` together with `RELAY_TOKEN`.

## Sharing

| Command | |
|---|---|
| `relay sessions [--tool claude\|opencode\|codex]` | Your local agent sessions for this repo, across tools |
| `relay share` | Pick a session, choose what to include and who sees it, confirm |

`relay share` options:

| Flag | |
|---|---|
| `--tool <tool>` | Only sessions from `claude`, `opencode` or `codex` |
| `--id <id>` | A specific session (prefix is fine; see `relay sessions`) |
| `--latest` | The newest session, without asking |
| `--include <mode>` | `summary`, `summary+tail` (default) or `full` |
| `--tail <n>` | Messages to keep with `summary+tail` (default 30) |
| `--title <title>` | Title teammates see |
| `--people <names>` | Comma-separated names or emails. Default: the whole team |
| `--summary-file <file>` | JSON `{goal, decisions, done, next, open_questions}`. Without it, the summary is the first request and the last answer |
| `--dry-run` | Write what would be uploaded to `.relay/dry-run-*.json` and stop |
| `-y, --yes` | Don't ask questions |
| `--json` | Print `{id, title, redactions}` |

Example for scripts: `relay share --tool claude --latest --yes --json`.

## Reading

| Command | |
|---|---|
| `relay list` | Shared sessions for this repo |
| `relay list --all` | All repos |
| `relay search "<query>"` | Full-text search over titles, summaries and messages |
| `relay show <id>` | Print a session as a handoff |
| `relay pull <id>` | Write `.relay/handoff-<id>.md` for your agent |

`list` and `search` options: `--repo`, `--author <name|email|me>`, `--tool`, `--limit` (default 20), `--json`. `list` also takes `--branch`.

`show` and `pull` options:
- `--summary-only`: no messages.
- `--full`: the full transcript, when it was shared. `show` prints the first page; `pull` fetches every page.
- `show --tail <n>`: only the last n messages.
- `pull --out <file>`: choose the output file.

## Managing

| Command | |
|---|---|
| `relay delete <id> [-y]` | Delete your share. Admins can delete any share |
| `relay members` | People in your org |
| `relay invite <email> --name <name> [--role member\|admin\|owner]` | Admins: add someone and print their one-time login command |

## Agents

| Command | |
|---|---|
| `relay setup [--tools claude,opencode,codex] [--scope user\|project] [--relay-config <file>]` | Install the MCP server and `/share` `/pickup` into your agents |
| `relay mcp` | The MCP server on stdio. Your agent starts it; you don't run it yourself |
