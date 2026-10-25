# Working live

`/share` and `/pickup` are for handing work over. **Live** is for when two people are working at the same time: their agents can talk to each other between steps.

```
Rahul (Claude Code):   /live
Akshat (OpenCode):     /live
Akshat:                tell Rahul I'm renaming src/billing.ts to invoice.ts in 10 minutes
Rahul's agent, before its next step:
   Akshat says: I'm renaming src/billing.ts to invoice.ts in 10 minutes.
   (shows it to Rahul and asks before acting on it)
```

What you get once you're live:

- **Who's working right now**: repo, branch, what each person is doing, and which files they touched recently. In the web app (**Live**), with `relay live status`, or ask your agent.
- **Messages between sessions**: tell a teammate about a change that affects them, ask a question, or answer one. Messages reach their agent **between its steps**, without anyone copying and pasting.
- **Overlap warnings**: before your agent edits a file a teammate changed in the last 30 minutes, it's told who and when, so you can coordinate before you conflict.
- **You decide what the agent does with messages**: by default it **shows you each message and asks** before acting. You can let it act on its own (see [Auto](#auto-let-the-agent-act-without-asking)).

Live is **opt-in**: nothing about your session is visible until you run `/live`, and it ends when you stop it or close the agent.

## Start

In any agent with Session Relay set up:

```
/live
```

The agent goes live in the current repo with a short title of what you're working on, and tells you who else is live there and which files they're touching. Other forms:

| You type | What happens |
|---|---|
| `/live` | Go live in this repo |
| `/live with Akshat` or `tell Akshat …` | Go live (if not already) and send Akshat a message |
| `ask Akshat whether the migration is done` | Sends a question; Akshat's agent asks Akshat before answering, unless Akshat turned on auto |
| `/live who` | Who's live, where, on which files |
| `/live inbox` | New messages (for agents without hooks) |
| `/live auto on` / `/live auto off` | Let your agent act on messages without asking, or not |
| `/live stop` | Stop being live |

From the terminal it's the same with `relay live`:

```sh
relay live start --title "billing refactor"
relay live status
relay live send akshat "I renamed createInvoice to buildInvoice; update your caller"
relay live send everyone --question "is anyone touching migrations?"
relay live reply 42 "yes, done in 10 minutes"
relay live inbox          # take new messages yourself
relay live watch          # print messages as they arrive (your agent still gets them)
relay live auto on|off
relay live stop
```

`everyone` sends to everyone live in the same repo. A message to a person goes to their live session in the same repo, or to all their live sessions if they're working elsewhere.

## How messages reach a running agent

An agent only takes in new input between steps, so delivery depends on the agent:

| Agent | How messages arrive |
|---|---|
| **Claude Code** | Hooks, automatically: before each of your prompts, before edits (with overlap warnings), after tools, and when the agent is about to stop. If a message arrives while it's finishing, it keeps going to tell you about it. |
| **Gemini CLI** | Hooks, automatically: before each turn, after tools (overlap warnings after edits), and after the reply. |
| **Codex, OpenCode, Copilot CLI, Cursor, ZCode** | The agent checks with `check_live_inbox` before each new task and before finishing a reply (Session Relay's MCP instructions tell it to). You can also say "check live messages", or `/live inbox`. |
| **You** | The web app's **Live** page, or `relay live watch` in a terminal. |

Turn on the hooks once per laptop:

```sh
relay setup --live on       # Claude Code and Gemini CLI; restart them afterwards
relay setup --live off      # remove them
```

The hooks only talk to the server while you're live: when you aren't, they exit immediately. They time out after a few seconds and never fail the agent's step, so a server outage doesn't get in your way. Tool hooks check for messages at most every 15 seconds; prompts, edits and stops always check.

`/live` is tied to the agent session that started it. Another Claude Code window in the same repo isn't live unless it runs `/live` too. `/clear` keeps you live in the new conversation; closing the agent ends it.

## Auto: let the agent act without asking

By default teammates' messages are treated as **information, not instructions**: your agent shows them to you and asks before doing anything about them.

If you trust the flow (say, you and a teammate are pairing on one feature), you can let your agent act on them:

- `/live auto on`, `relay live auto on`, or the switch on your live session in the web app.
- It's per live session, off by default, and only you can turn it on for yours.

With auto on, the agent acts only when a message fits the current task, tells you what it did and why, and still refuses to push, deploy, run destructive commands, change credentials or reveal secrets because a message asks. Admins can switch auto off for the whole org (**Settings → General → Live sessions**); that also turns it off in live sessions already running.

## Safety and limits

- **Agents can't loop.** After 8 agent-written messages in a row between the same two people (within 30 minutes), sending pauses until one of them replies themselves (web app or `relay live send`).
- **Messages are redacted** like everything else: on your laptop before sending, and again on the server with your org's patterns.
- **Who sees what**: everyone in the org can see who is live, where, and which files they touched. Messages are only visible to the two people involved.
- **Caps**: 4,000 characters per message, 30 messages per person per minute, 500 messages per live session, 5 open live sessions per person and 200 per org. At most 20 messages are delivered per check (the agent is told when more are waiting).
- **Cleanup**: a live session with no activity for 15 minutes shows as away, and ends after 12 hours. Ended live sessions and their messages are deleted after 7 days.
- **Audit log**: going live, ending, auto on or off, and every message (who sent it, to how many sessions, whether an agent wrote it) are recorded. The message text isn't.

## MCP tools

| Tool | |
|---|---|
| `start_live` | Go live in this repo; lists who else is live and their files |
| `live_status` | Who's live right now, and whether this session is |
| `send_live_message` | Message a teammate, `everyone`, or a live session; `kind: "question"`, `reply_to`, and `wait_seconds` (up to 120) to wait for the answer |
| `check_live_inbox` | Take new messages (agents without hooks) |
| `update_live` | Title, current status, or auto on/off (only when you ask) |
| `stop_live` | Stop being live |

## API

For scripts and other clients (all under `/v1/live`, with a personal token):

| | |
|---|---|
| `GET /v1/live` | Open live sessions in the org (`?ended=1` adds ones ended in the last day) |
| `POST /v1/live` | Start: `{ repo, branch?, tool?, title?, autonomy? }` |
| `GET /v1/live/:id` | One live session, with the messages between you and it |
| `PATCH /v1/live/:id` | Owner: `{ title?, status?, branch?, autonomy? }` |
| `POST /v1/live/:id/poll` | Owner: heartbeat, `{ files?, status?, ack? }`; returns unread messages (marked read unless `ack: false`) and overlaps |
| `POST /v1/live/:id/read` | Owner: mark messages read without taking them |
| `POST /v1/live/:id/end` | Owner or admin |
| `POST /v1/live/messages` | `{ to_live \| to_user \| to_repo, body, kind?, reply_to?, from_live?, from_agent? }` |
