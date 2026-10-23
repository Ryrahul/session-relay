# FAQ

**Can I continue a Claude Code session in OpenCode (or the other way round)?**
Yes. That's the main use. The receiving agent gets the handoff (summary plus recent conversation) as context, not the other tool's internal session format.

**Is the whole session shared?**
By default: the summary, the last 30 messages and the files touched. Ask for `/share full transcript` or use `--include full` for everything. Tool calls are always reduced to one line each. See [Security & privacy](security.md).

**`relay share` says no sessions were found.**
Run it inside the git repo where you used the agent; sessions are matched by folder. Check with `relay sessions`. For OpenCode, the `opencode` command must be on your PATH.

**The agent doesn't have `/share` or `/pickup`.**
Run `relay setup`, then fully restart the agent. Check that `relay mcp` starts: it should wait silently; Ctrl-C to exit. In Claude Code, `/mcp` lists connected servers.

**`/share` shared the wrong session.**
`share_current_session` takes the newest session for this repo from the agent you're in. If you had two sessions open in the same repo at once, use `relay share` and pick the right one.

**Can I share without the CLI or MCP?**
The web app is for reading. Sharing needs the CLI, because sessions live on your laptop.

**Where do handoff files go?**
`.relay/handoff-<id>.md` in the repo. The folder has its own `.gitignore`, so it's never committed.

**How do I remove something I shared?**
Open it in the web app → **Delete share**, or `relay delete <id>`.

**Is there a hosted version?**
Cloud hosting is coming soon. Until then, [self-host](self-hosting.md) it. It's one `docker compose up`.

**Does it work with Cursor, Aider, Gemini CLI…?**
Not yet. Each tool needs a small adapter that reads its session format. Contributions are welcome; see `packages/cli/src/adapters/`.
