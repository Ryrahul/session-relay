#!/usr/bin/env node
import { Command } from "commander";
import { login } from "./commands/login.js";
import { whoami } from "./commands/whoami.js";

const program = new Command()
  .name("relay")
  .description("Share coding-agent sessions with your team")
  .version("0.0.1");

program
  .command("login")
  .description("Connect this machine to a relay server")
  .requiredOption("--server <url>", "server URL, e.g. https://relay.example.com")
  .requiredOption("--token <token>", "your personal token")
  .action(login);

program.command("whoami").description("Show the current user, org and server").action(whoami);

const planned: [string, string, string][] = [
  ["share", "Pick a recent session and share it", "Phase 1–2"],
  ["list", "List the team's shared sessions", "Phase 2"],
  ["search", "Search shared sessions", "Phase 2"],
  ["show", "Print a shared session's summary", "Phase 2"],
  ["pull", "Write a shared session to a local handoff file", "Phase 2"],
  ["delete", "Delete one of your shares", "Phase 2"],
  ["mcp", "Run the MCP server for Claude Code, Codex and OpenCode", "Phase 3"],
];
for (const [name, description, phase] of planned) {
  program
    .command(name)
    .description(`${description} (coming in ${phase})`)
    .allowUnknownOption()
    .action(() => {
      console.error(`relay ${name} is not built yet (${phase}).`);
      process.exitCode = 2;
    });
}

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
