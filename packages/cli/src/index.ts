import { Command } from "commander";
import { login } from "./commands/login.js";
import { edit, invite, list, localSessions, members, prComment, pull, remove, search, share, show } from "./commands/sessions.js";
import { setup } from "./commands/setup.js";
import { whoami } from "./commands/whoami.js";
import { runMcp } from "./mcp.js";
import { VERSION } from "./version.js";

const program = new Command()
  .name("relay")
  .description("Share coding-agent sessions (Claude Code, OpenCode, Codex, ZCode) with your team")
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
  .option("--tool <tool>", "claude, opencode, codex or zcode")
  .action(localSessions);

program
  .command("share")
  .description("Pick a local session and share it with your team")
  .option("--tool <tool>", "claude, opencode, codex or zcode")
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
  .option("--pr <url>", 'pull request it belongs to (default: this branch\'s open PR via gh; "none" to leave out)')
  .action(share);

const listOpts = (cmd: Command) =>
  cmd
    .option("--repo <repo>", "e.g. github.com/acme/api")
    .option("--author <name>", 'name, email or "me"')
    .option("--tool <tool>", "claude, opencode, codex or zcode")
    .option("--branch <branch>")
    .option("--file <path>", "only sessions that touched this file (part of the path is fine)")
    .option("--for-me", "only handoffs assigned to you")
    .option("--limit <n>", "max results", "20")
    .option("--json", "print JSON");

listOpts(program.command("list").description("List shared sessions (this repo by default)"))
  .option("--all", "all repos")
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
  .option("--summary-file <file>", "replace the whole summary with this JSON")
  .option("--for <name>", 'teammate it\'s for, or "none"')
  .option("--pr <url>", 'pull request URL, or "none"')
  .option("--team", "make it visible to the whole team")
  .option("--people <names>", "make it visible only to these people")
  .action(edit);

program
  .command("pr-comment <id>")
  .description("Comment on the session's pull request with a link and next steps (uses the GitHub CLI)")
  .option("--pr <url>", "pull request URL, if the share doesn't have one yet")
  .action(prComment);

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
  .description("Connect Claude Code, OpenCode, Codex and ZCode to relay (MCP server + /share and /pickup commands)")
  .option("--tools <list>", "comma-separated: claude,opencode,codex,zcode")
  .option("--scope <scope>", "user (default) or project", "user")
  .option("--relay-config <file>", "relay config file the MCP server should use")
  .action(setup);

program.command("mcp").description("Run the MCP server on stdio (started by your agent)").action(runMcp);

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
