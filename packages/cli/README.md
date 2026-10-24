# session-relay

Share coding-agent sessions with your team across **Claude Code**, **OpenCode**, **Codex** and **ZCode**. Run `/share` in one agent; a teammate runs `/pickup` in whichever agent they use and carries on with the goal, decisions, next steps and recent conversation.

```sh
npm install -g session-relay
relay login --server https://relay.your-team.com --token srk_...
relay setup     # adds the relay MCP server and /share, /pickup to your agents
```

Then, in your agent:

```
/share
/pickup alice's webhook retry work
```

You need a Session Relay server for your team; see [self-hosting](https://relay.rahulweb.online/docs/self-hosting.html). Cloud hosting is coming soon.

## Commands

| | |
|---|---|
| `relay sessions` | Your local agent sessions for this repo |
| `relay share [--dry-run]` | Pick a session, choose what to include and who sees it |
| `relay list`, `relay search "<q>"` | Shared sessions |
| `relay show <id>`, `relay pull <id>` | Read a session, or write `.relay/handoff-<id>.md` for your agent |
| `relay setup` | Connect Claude Code, OpenCode, Codex and ZCode |
| `relay mcp` | The MCP server your agents start |

Full reference: [CLI docs](https://relay.rahulweb.online/docs/cli.html).

## Privacy

Nothing is uploaded unless you share it. API keys, tokens, passwords and private keys are removed on your machine before upload, and `relay share --dry-run` shows exactly what would be sent. See [security & privacy](https://relay.rahulweb.online/docs/security.html).

## License

AGPL-3.0-only
