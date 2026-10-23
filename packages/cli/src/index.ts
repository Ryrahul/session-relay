import { Command } from "commander";
import { login } from "./commands/login.js";
import { invite, list, localSessions, members, pull, remove, search, share, show } from "./commands/sessions.js";
import { setup } from "./commands/setup.js";
import { whoami } from "./commands/whoami.js";
import { runMcp } from "./mcp.js";
import { VERSION } from "./version.js";

const program = new Command()
  .name("relay")
  .description("Share coding-agent sessions (Claude Code, OpenCode, Codex) with your team")
  .version(VERSION);

program
  .command("login")
  .description("Connect this machine to a relay server")
  .requiredOption("--server <url>", "server URL, e.g. https://relay.example.com")
  .requiredOption("--token <token>", "your personal token")
  .action(login);

program.command("whoami").description("Show the current user, org and server").action(whoami);

program
  .command("sessions")
  .description("List your local agent sessions for this repo")
  .option("--tool <tool>", "claude, opencode or codex")
  .action(localSessions);

program
  .command("share")
  .description("Pick a local session and share it with your team")
  .option("--tool <tool>", "claude, opencode or codex")
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
  .action(share);

const listOpts = (cmd: Command) =>
  cmd
    .option("--repo <repo>", "e.g. github.com/acme/api")
    .option("--author <name>", 'name, email or "me"')
    .option("--tool <tool>", "claude, opencode or codex")
    .option("--limit <n>", "max results", "20")
    .option("--json", "print JSON");

listOpts(program.command("list").description("List shared sessions (this repo by default)"))
  .option("--all", "all repos")
  .option("--branch <branch>")
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

program.command("delete <id>").description("Delete one of your shares").option("-y, --yes").action(remove);
program.command("members").description("List people in your org").action(members);
program
  .command("invite <email>")
  .description("Add someone to your org (admins) and print their login command")
  .requiredOption("--name <name>")
  .option("--role <role>", "member | admin | owner", "member")
  .action(invite);

program
  .command("setup")
  .description("Connect Claude Code, OpenCode and Codex to relay (MCP server + /share and /pickup commands)")
  .option("--tools <list>", "comma-separated: claude,opencode,codex")
  .option("--scope <scope>", "user (default) or project", "user")
  .option("--relay-config <file>", "relay config file the MCP server should use")
  .action(setup);

program.command("mcp").description("Run the MCP server on stdio (started by your agent)").action(runMcp);

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
