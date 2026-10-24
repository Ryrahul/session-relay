# session-relay

Share coding-agent sessions with your team across **Claude Code**, **Codex**, **OpenCode**, **Gemini CLI**, **Copilot CLI**, **Cursor** and **ZCode**. Run `/share` in one agent; a teammate runs `/pickup` in whichever agent they use and carries on with the goal, decisions, next steps and recent conversation.

```sh
npm install -g session-relay
relay login --server https://relay.your-team.com   # approve in the browser
relay setup     # adds the relay MCP server and /share, /pickup to your agents
```

Then, in your agent:

```
/share
/share for bob
/pickup
/pickup alice's webhook retry work
```

You need a Session Relay server for your team; see [self-hosting](https://relay.rahulweb.online/docs/self-hosting.html). Cloud hosting is coming soon.

## Commands

| | |
|---|---|
| `relay sessions` | Your local agent sessions for this repo |
| `relay share [--dry-run]` | Pick a session, choose what to include and who sees it |
| `relay share --for <name>` | A handoff for a teammate (also `--pr <url>`; the branch's PR is found automatically) |
| `relay list`, `relay search "<q>"` | Shared sessions. `--for-me`, `--file <path>`, or `file:` / `branch:` in the query |
| `relay show <id>`, `relay pull <id>` | Read a session, or write `.relay/handoff-<id>.md` for your agent |
| `relay edit <id>` | Change your share: title, summary, next steps, who it's for, PR |
| `relay pr-comment <id>` | Post the session on its pull request |
| `relay setup --auto-share on` | Save each Claude Code, Gemini CLI and Copilot CLI session as a private draft when it ends; `relay publish <id>` shares it |
| `relay digest`, `relay stats` | What the team did lately; team stats |
| `relay comment <id> "<text>"` | Leave a note on a session (the next agent reads it) |
| `relay delete <id>` | Delete your share |
| `relay members`, `relay invite --link` | Your team; invite links (admins) |
| `relay setup` | Connect every agent you have installed |
| `relay mcp` | The MCP server your agents start |

Full reference: [CLI docs](https://relay.rahulweb.online/docs/cli.html).

## Privacy

Nothing is uploaded unless you share it. API keys, tokens, passwords and private keys are removed on your machine before upload, and `relay share --dry-run` shows exactly what would be sent. See [security & privacy](https://relay.rahulweb.online/docs/security.html).

## License

AGPL-3.0-only
