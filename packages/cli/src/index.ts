import { Command } from "commander";
import { login } from "./commands/login.js";
import { auditCmd, comment, configCmd, digest, edit, exportCmd, template, invite, list, localSessions, members, prComment, publish, pull, remove, search, share, show, stats } from "./commands/sessions.js";
import { hook } from "./commands/hook.js";
import { liveCommand } from "./commands/live.js";
import { setup } from "./commands/setup.js";
import { whoami } from "./commands/whoami.js";
import { runMcp } from "./mcp.js";
import { VERSION } from "./version.js";

const program = new Command()
  .name("relay")
  .description("Share coding-agent sessions (Claude Code, OpenCode, Codex, ZCode, Gemini CLI, Copilot CLI, Cursor) with your team")
  .version(VERSION);

program
  .command("login")
  .description("Connect this machine to a relay server")
  .requiredOption("--server <url>", "server URL, e.g. https://relay.example.com")
  .option("--token <token>", "personal token; without it, sign in through the browser")
  .option("--no-browser", "print the sign-in link instead of opening a browser")
  .action(login);

program.command("whoami").description("Show the current user, org and server").action(whoami);

program
  .command("sessions")
  .description("List your local agent sessions for this repo")
  .option("--tool <tool>", "claude, opencode, codex, zcode, gemini, copilot or cursor")
  .action(localSessions);

program
  .command("share")
  .description("Pick a local session and share it with your team")
  .option("--tool <tool>", "claude, opencode, codex, zcode, gemini, copilot or cursor")
  .option("--id <id>", "native session id (prefix is fine)")
  .option("--latest", "share the newest session without asking")
  .option("--include <mode>", "summary | summary+tail | full")
  .option("--tail <n>", "messages to keep with summary+tail", "30")
  .option("--title <title>", "title shown to teammates")
  .option("--people <names>", "comma-separated names/emails; default is the whole team")
  .option("--summary-file <file>", "JSON summary {goal, decisions, done, next, open_questions}")
  .option("--dry-run", "write what would be uploaded to .relay/ and stop")
  .option("-y, --yes", "don't ask questions")
  .option("--json", "print the result as JSON")
  .option("--continues <id>", 'shared session this continues (default: the one you last picked up here; "none" to unlink)')
  .option("--for <name>", "teammate this handoff is for; it shows first in their /pickup")
  .option("--prompts", "include your typed prompts (when relay config prompts is hide)")
  .option("--no-prompts", "leave your typed prompts out; the agent's replies and tool steps are kept")
  .option("--diff", "attach your uncommitted changes (git diff plus new files), redacted")
  .option("--pr <url>", 'pull request it belongs to (default: this branch\'s open PR via gh; "none" to leave out)')
  .action(share);

const listOpts = (cmd: Command) =>
  cmd
    .option("--repo <repo>", "e.g. github.com/acme/api")
    .option("--author <name>", 'name, email or "me"')
    .option("--tool <tool>", "claude, opencode, codex, zcode, gemini, copilot or cursor")
    .option("--branch <branch>")
    .option("--file <path>", "only sessions that touched this file (part of the path is fine)")
    .option("--for-me", "only handoffs assigned to you")
    .option("--limit <n>", "max results", "20")
    .option("--json", "print JSON");

listOpts(program.command("list").description("List shared sessions (this repo by default)"))
  .option("--all", "all repos")
  .option("--drafts", "your drafts (saved automatically at session end), from any repo")
  .action(list);

listOpts(program.command("search <query>").description("Search shared sessions")).action(search);

program
  .command("show <id>")
  .description("Print a shared session as a handoff")
  .option("--full", "full transcript (first page)")
  .option("--summary-only", "no messages")
  .option("--tail <n>", "number of recent messages")
  .option("--json", "print JSON")
  .action(show);

program
  .command("pull <id>")
  .description("Write a shared session to .relay/handoff-<id>.md for your agent to read")
  .option("--full", "include the full transcript")
  .option("--summary-only", "no messages")
  .option("--out <file>", "output file")
  .action(pull);

const collect = (v: string, prev: string[] = []) => [...prev, v];
program
  .command("edit <id>")
  .description("Change one of your shares: title, summary, who it's for, PR, visibility")
  .option("--title <title>")
  .option("--goal <text>", "replace the goal")
  .option("--add-next <text>", "add a next step (repeatable)", collect)
  .option("--clear-next", "remove the existing next steps first")
  .option("--add-done <text>", "add to done (repeatable)", collect)
  .option("--add-decision <text>", "add a decision (repeatable)", collect)
  .option("--add-question <text>", "add an open question (repeatable)", collect)
  .option("--section <title=item>", 'add an item to a section, e.g. "Tests run=npm test passes" (repeatable)', collect)
  .option("--summary-file <file>", "replace the whole summary with this JSON")
  .option("--for <name>", 'teammate it\'s for, or "none"')
  .option("--pr <url>", 'pull request URL, or "none"')
  .option("--team", "make it visible to the whole team")
  .option("--people <names>", "make it visible only to these people")
  .action(edit);

program
  .command("publish <id>")
  .description("Share a draft with the whole team (or --people)")
  .option("--people <names>", "only these people")
  .option("--for <name>", "teammate it's for")
  .action(publish);

program
  .command("pr-comment <id>")
  .description("Comment on the session's pull request with a link and next steps (uses the GitHub CLI)")
  .option("--pr <url>", "pull request URL, if the share doesn't have one yet")
  .action(prComment);

program
  .command("template")
  .description("Show the handoff template for this repo (sections a share should include)")
  .option("--repo <repo>", "another repo")
  .action(template);

program
  .command("export [id]")
  .description("Download a session (Markdown or JSON, full transcript included); without an id, all of a repo's sessions as NDJSON")
  .option("--format <format>", "md (default) or json, for one session")
  .option("-o, --out <file>", "write to a file instead of the terminal")
  .option("--repo <repo>", "repo to export (default: this repo)")
  .option("--all", "every repo")
  .option("--since <date>", "only sessions shared since this date (YYYY-MM-DD)")
  .option("--full", "include full transcripts (bulk export)")
  .option("--no-prompts", "replace the authors' typed prompts with a marker")
  .action(exportCmd);

program
  .command("config [key] [value]")
  .description('CLI settings. "relay config prompts hide" leaves your typed prompts out of everything you share')
  .action(configCmd);

program
  .command("audit")
  .description("Admins: the org's audit log (shares, pulls, edits, exports, members, tokens, settings)")
  .option("--action <prefix>", 'e.g. "session.share", "session", "member"')
  .option("--user <name>", "only this person")
  .option("--session <id>", "only events about this session")
  .option("--limit <n>", "entries (max 200)", "50")
  .option("--json", "print JSON")
  .action(auditCmd);

program
  .command("digest")
  .description("What the team did lately: new shares by repo, handoffs for you, pickups, comments")
  .option("--days <n>", "look back this many days (1-30)", "1")
  .action(digest);

program
  .command("stats")
  .description("Team stats: shares, pickups, continued handoffs and comments, by day, person, agent and repo")
  .option("--days <n>", "period in days (1-90)", "30")
  .option("--json", "print JSON")
  .action(stats);

program
  .command("comment <id> [text...]")
  .description("Leave a note on a shared session; without text, list its comments")
  .action(comment);

program.command("delete <id>").description("Delete one of your shares").option("-y, --yes").action(remove);
program.command("members").description("List people in your org").action(members);
program
  .command("invite [email]")
  .description("Admins: create an invite link (--link), or add someone directly and print their login command")
  .option("--link", "create a single-use invite link instead")
  .option("--days <n>", "invite link lifetime: 1-30 days", "7")
  .option("--name <name>", "their name (when adding directly)")
  .option("--role <role>", "member | admin | owner", "member")
  .action(invite);

program
  .command("setup")
  .description("Connect your agents to relay (MCP server + /share and /pickup commands)")
  .option("--tools <list>", "comma-separated: claude,opencode,codex,zcode,gemini,copilot,cursor")
  .option("--scope <scope>", "user (default) or project", "user")
  .option("--relay-config <file>", "relay config file the MCP server should use")
  .option("--auto-share <on|off>", "save each session as a private draft when it ends (Claude Code, Gemini CLI, Copilot CLI)")
  .option("--live <on|off>", "hooks that bring teammates' live messages into Claude Code and Gemini CLI between steps")
  .action(setup);

program
  .command("live [action] [args...]")
  .description("Work live with teammates: start | status | send <name|everyone> <text> | reply <#> <text> | inbox | watch | auto on|off | stop")
  .option("--title <title>", "start: what you're working on")
  .option("--auto", "start: let your agent act on teammates' messages without asking you first")
  .option("--tool <tool>", "start: the agent this live session is for (claude, opencode, codex, zcode, gemini, copilot, cursor)")
  .option("--question", "send: ask a question (the other agent is asked to answer)")
  .option("--all", "stop: end all your live sessions on this machine")
  .option("--json", "status: print JSON")
  .addHelpText(
    "after",
    `
Examples:
  relay live start --title "billing refactor"
  relay live status
  relay live send akshat "I renamed createInvoice to buildInvoice, update your caller"
  relay live send everyone --question "is anyone touching migrations?"
  relay live reply 42 "yes, done in 10 minutes"
  relay live watch
  relay live stop`,
  )
  .action((action, args, opts) => liveCommand(action, args, opts));

program
  .command("hook <event> [sub]")
  .description("Run by agent hooks (session-end, live <event>); not for direct use")
  .requiredOption("--tool <tool>", "agent that ran the hook")
  .action(hook);

program.command("mcp").description("Run the MCP server on stdio (started by your agent)").action(runMcp);

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
