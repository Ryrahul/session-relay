# FAQ

**I installed a new agent. How do I connect it?**
`relay setup --tools <agent>`, e.g. `relay setup --tools gemini`, then restart that agent. See [Agents](agents.md#added-an-agent-later).

**Can I get my sessions out?**
Yes. Download one from its page (Markdown or JSON, full transcript included) or `relay export <id>`. Export many with **Settings → Export** or `relay export` in a repo (`--all` for every repo, `--full` for full transcripts): one JSON object per line.

**Does my email have to match my coding-agent accounts?**
No. In Session Relay the email is just how teammates are told apart (and stops someone being added twice). It isn't linked to any agent account. You log in with your token, never your email.

**Can I continue a Claude Code session in OpenCode (or the other way round)?**
Yes. That's the main use. The receiving agent gets the handoff (summary plus recent conversation) as context, not the other tool's internal session format.

**Two of us are working at the same time. Can our agents talk to each other?**
Yes: both run `/live`. You see who's on what and which files they touch, get a warning before editing a file a teammate just changed, and can send messages ("tell Akshat I renamed createInvoice") that reach their agent between its steps. Run `relay setup --live on` once so messages arrive in Claude Code and Gemini CLI by themselves; other agents check with `check_live_inbox`. See [Working live](live.md).

**Will my agent do whatever a teammate's message says?**
No. By default it shows the message to you and asks before acting. You can turn on auto for your own live session (`/live auto on`) to let it act when a message fits the current task; even then it won't push, deploy, run destructive commands or reveal secrets because a message asks, and admins can switch auto off for the whole org.

**Live messages aren't showing up in my agent.**
Check you're live in that repo (`relay live status`). For Claude Code and Gemini CLI, run `relay setup --live on` and restart the agent; the hooks only deliver to the agent session that ran `/live`. Other agents get messages when they call `check_live_inbox` (or say "check live messages"). `relay live inbox` shows them in a terminal. Hook problems are logged to `hook.log` next to your relay config.

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

**How does Session Relay know my share continues someone else's work?**
When you `/pickup` or `relay pull` a session, it's remembered for that repo for 7 days. Your next share there links to it. Use `relay share --continues none` if it's unrelated.

**A teammate's invite link says it doesn't work.**
Links work once and expire. Create a new one in **Members → Invite with a link**. If they already joined, they should sign in with `relay login --server …` instead.

**Where do handoff files go?**
`.relay/handoff-<id>.md` in the repo. The folder has its own `.gitignore`, so it's never committed.

**How do I remove something I shared?**
Open it in the web app → **Delete share**, or `relay delete <id>`.

**Is there a hosted version?**
Cloud hosting is coming soon. Until then, [self-host](self-hosting.md) it. It's one `docker compose up`.

**Does it work with Cursor, Aider, Gemini CLI…?**
Not yet. Each tool needs a small adapter that reads its session format. Contributions are welcome; see `packages/cli/src/adapters/`.
