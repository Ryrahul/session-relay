import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { repoInfo } from "../git.js";

const run = promisify(execFile);

export const SHARE_PROMPT = `---
description: Share this session with your team (Session Relay)
---
Share this session with the team using the relay MCP tool \`share_current_session\`.

First call the relay MCP tool \`share_template\`: this repo may ask for extra sections.

Then write a handoff for a teammate who will continue this work, based on this conversation:
- goal: what we are trying to achieve, in one or two sentences
- decisions: key decisions made and why
- done: what is finished
- next: concrete next steps
- open_questions: anything unresolved
- sections: the template's sections, if it has any
Never include secrets, tokens or passwords.

Then call \`share_current_session\` with those fields. If the user says who it's for ("for Akshat"), pass \`for\`. If this session continued a teammate's shared session you loaded earlier, it is linked automatically; if the work is unrelated, pass \`continues: "none"\`. Extra instructions from the user (title, who should see it, "full transcript"): $ARGUMENTS

Reply with the share id and title only.
`;

export const PICKUP_PROMPT = `---
description: Load a teammate's shared session and continue it (Session Relay)
---
Load a teammate's shared session and continue it. Request: $ARGUMENTS

Use the relay MCP tools. If the request is empty, first check \`list_sessions\` with \`for_me: true\` (handoffs assigned to me). Otherwise use \`search_sessions\` or \`list_sessions\` to find the best match for this repo. Then \`get_session\` with mode "tail".
Read the goal, decisions, next steps and recent conversation. Check the current state of the code (git status, the files touched) before changing anything.
Then say in a few lines where things stand and continue with the first next step.
`;

type ToolName = "claude" | "opencode" | "codex" | "zcode" | "gemini" | "copilot" | "cursor";
const ALL_TOOLS = "claude,opencode,codex,zcode,gemini,copilot,cursor";

interface SetupOpts {
  tools?: string;
  scope?: "user" | "project";
  /** Point the MCP server at a specific relay config file (testing, several accounts). */
  relayConfig?: string;
  /** "on" installs the session-end hook that saves drafts, "off" removes it. */
  autoShare?: string;
}

const HOOK_MARK = "hook session-end";

function hookCommand(cmd: string[], env: Record<string, string>, tool: string): string {
  const prefix = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)} `).join("");
  return `${prefix}${cmd.slice(0, -1).map((c) => JSON.stringify(c)).join(" ")} hook session-end --tool ${tool}`;
}

/**
 * Adds or removes the SessionEnd hook that saves the session as a private draft. Claude Code and
 * Gemini CLI use the same settings.json shape for hooks.
 */
export async function setupClaudeAutoShare(
  on: boolean,
  cmd: string[],
  env: Record<string, string>,
  settingsFile?: string,
  tool: "claude" | "gemini" = "claude",
): Promise<string> {
  const file = settingsFile ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "settings.json");
  const cfg = await readJson(file);
  const groups: { matcher?: string; hooks: { type: string; command: string }[] }[] = cfg.hooks?.SessionEnd ?? [];
  // Drop any relay hook first, so running setup again doesn't duplicate it.
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? "").includes(HOOK_MARK)) }))
    .filter((g) => g.hooks.length);
  const command = hookCommand(cmd, env, tool);
  const next = on ? [...kept, { hooks: [{ type: "command", command }] }] : kept;
  cfg.hooks = { ...cfg.hooks, SessionEnd: next };
  if (!next.length) delete cfg.hooks.SessionEnd;
  if (cfg.hooks && !Object.keys(cfg.hooks).length) delete cfg.hooks;
  await writeText(file, JSON.stringify(cfg, null, 2) + "\n");
  return on ? `auto-share on: sessions are saved as private drafts when they end (${file})` : `auto-share off (${file})`;
}

/** Copilot CLI reads hooks from ~/.copilot/hooks/*.json; relay keeps its own file there. */
export async function setupCopilotAutoShare(on: boolean, cmd: string[], env: Record<string, string>, home = copilotHome()): Promise<string> {
  const file = path.join(home, "hooks", "relay.json");
  if (!on) {
    await rm(file, { force: true });
    return `auto-share off (${file})`;
  }
  const cfg = { version: 1, hooks: { sessionEnd: [{ type: "command", bash: hookCommand(cmd, env, "copilot"), timeoutSec: 60 }] } };
  await writeText(file, JSON.stringify(cfg, null, 2) + "\n");
  return `auto-share on: sessions are saved as private drafts when they end (${file})`;
}

const copilotHome = () => process.env.COPILOT_HOME ?? path.join(homedir(), ".copilot");
const geminiHome = () => path.join(process.env.GEMINI_CLI_HOME ?? homedir(), ".gemini");
const cursorHome = () => process.env.CURSOR_HOME ?? path.join(homedir(), ".cursor");

/** The shared prompts without frontmatter, for tools whose command files have none. */
function promptBody(prompt: string, args: string): string {
  return prompt.replace(/^---\n[\s\S]*?\n---\n/, "").replace("$ARGUMENTS", args);
}

const description = (prompt: string) => /^description: (.+)$/m.exec(prompt)?.[1] ?? "";

/** Merges `relay` into a JSON file's `mcpServers`. */
async function addMcpServer(file: string, entry: Record<string, unknown>) {
  const cfg = await readJson(file);
  cfg.mcpServers = { ...cfg.mcpServers, relay: entry };
  await writeText(file, JSON.stringify(cfg, null, 2) + "\n");
}

async function setupGemini(scope: "user" | "project", root: string, cmd: string[], env: Record<string, string>): Promise<string[]> {
  const base = scope === "project" ? path.join(root, ".gemini") : geminiHome();
  const file = path.join(base, "settings.json");
  await addMcpServer(file, { command: cmd[0], args: cmd.slice(1), ...(Object.keys(env).length ? { env } : {}) });
  const dir = path.join(base, "commands");
  // Gemini commands are TOML; {{args}} is what the user typed after the command.
  const toml = (prompt: string) =>
    `description = ${JSON.stringify(description(prompt))}\nprompt = """\n${promptBody(prompt, "{{args}}").replace(/"""/g, '\\"""')}"""\n`;
  await writeText(path.join(dir, "share.toml"), toml(SHARE_PROMPT));
  await writeText(path.join(dir, "pickup.toml"), toml(PICKUP_PROMPT));
  return [`MCP server in ${file}`, `/share and /pickup in ${dir}`];
}

async function setupCopilot(scope: "user" | "project", root: string, cmd: string[], env: Record<string, string>): Promise<string[]> {
  const file = scope === "project" ? path.join(root, ".mcp.json") : path.join(copilotHome(), "mcp-config.json");
  await addMcpServer(file, { type: "local", command: cmd[0], args: cmd.slice(1), tools: ["*"], ...(Object.keys(env).length ? { env } : {}) });
  // Copilot's slash commands are skills: <dir>/<name>/SKILL.md.
  const dir = scope === "project" ? path.join(root, ".github", "skills") : path.join(copilotHome(), "skills");
  const skill = (name: string, prompt: string) =>
    `---\nname: ${name}\ndescription: ${description(prompt)}\n---\n${promptBody(prompt, "whatever the user wrote after the command, if anything")}`;
  await writeText(path.join(dir, "share", "SKILL.md"), skill("share", SHARE_PROMPT));
  await writeText(path.join(dir, "pickup", "SKILL.md"), skill("pickup", PICKUP_PROMPT));
  return [`MCP server in ${file}`, `/share and /pickup skills in ${dir}`];
}

async function setupCursor(scope: "user" | "project", root: string, cmd: string[], env: Record<string, string>): Promise<string[]> {
  const base = scope === "project" ? path.join(root, ".cursor") : cursorHome();
  const file = path.join(base, "mcp.json");
  await addMcpServer(file, { type: "stdio", command: cmd[0], args: cmd.slice(1), ...(Object.keys(env).length ? { env } : {}) });
  const dir = path.join(base, "commands");
  const args = "whatever the user wrote after the command, if anything";
  await writeText(path.join(dir, "share.md"), promptBody(SHARE_PROMPT, args));
  await writeText(path.join(dir, "pickup.md"), promptBody(PICKUP_PROMPT, args));
  return [`MCP server in ${file}`, `/share and /pickup in ${dir}`];
}

/** Whether an agent is installed: its command, or (for desktop apps) its data folder. */
async function installed(tool: ToolName): Promise<boolean> {
  switch (tool) {
    case "zcode":
      return (await has("zcode")) || existsSync(path.join(homedir(), ".zcode"));
    case "cursor":
      return (await has("cursor-agent")) || existsSync(cursorHome());
    case "gemini":
      return (await has("gemini")) || existsSync(geminiHome());
    case "copilot":
      return (await has("copilot")) || existsSync(copilotHome());
    default:
      return has(tool);
  }
}

/** How agents should launch `relay mcp`: the installed binary if on PATH, else this script via node. */
async function mcpCommand(): Promise<string[]> {
  try {
    await run("relay", ["--version"]);
    return ["relay", "mcp"];
  } catch {
    // The script that is running right now (dist/relay.js when installed, or the dev entry).
    const script = path.resolve(process.argv[1] ?? "");
    return [process.execPath, script, "mcp"];
  }
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`${file} is not plain JSON; add the relay MCP server to it by hand.`);
  }
}

async function writeText(file: string, body: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

async function has(bin: string): Promise<boolean> {
  try {
    await run(bin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function setupClaude(scope: "user" | "project", root: string, cmd: string[], env: Record<string, string>): Promise<string[]> {
  const done: string[] = [];
  if (scope === "project") {
    const file = path.join(root, ".mcp.json");
    const cfg = await readJson(file);
    cfg.mcpServers = { ...cfg.mcpServers, relay: { command: cmd[0], args: cmd.slice(1), ...(Object.keys(env).length ? { env } : {}) } };
    await writeText(file, JSON.stringify(cfg, null, 2) + "\n");
    done.push(`MCP server in ${path.relative(root, file)}`);
  } else {
    await run("claude", ["mcp", "remove", "relay", "--scope", "user"]).catch(() => undefined);
    const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    await run("claude", ["mcp", "add", "--scope", "user", ...envArgs, "relay", "--", ...cmd]);
    done.push("MCP server (claude mcp add --scope user)");
  }
  const dir = scope === "project" ? path.join(root, ".claude", "commands") : path.join(homedir(), ".claude", "commands");
  await writeText(path.join(dir, "share.md"), SHARE_PROMPT);
  await writeText(path.join(dir, "pickup.md"), PICKUP_PROMPT);
  done.push(`/share and /pickup in ${dir}`);
  return done;
}

async function setupOpenCode(scope: "user" | "project", root: string, cmd: string[], env: Record<string, string>): Promise<string[]> {
  const configDir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "opencode");
  const file = scope === "project" ? path.join(root, "opencode.json") : path.join(configDir, "opencode.json");
  if (scope === "user" && existsSync(path.join(configDir, "opencode.jsonc"))) {
    throw new Error(`${path.join(configDir, "opencode.jsonc")} has comments; add {"mcp":{"relay":{"type":"local","command":${JSON.stringify(cmd)}}}} by hand.`);
  }
  const cfg = await readJson(file);
  cfg.$schema ??= "https://opencode.ai/config.json";
  cfg.mcp = { ...cfg.mcp, relay: { type: "local", command: cmd, enabled: true, ...(Object.keys(env).length ? { environment: env } : {}) } };
  await writeText(file, JSON.stringify(cfg, null, 2) + "\n");
  const dir = scope === "project" ? path.join(root, ".opencode", "commands") : path.join(configDir, "commands");
  await writeText(path.join(dir, "share.md"), SHARE_PROMPT);
  await writeText(path.join(dir, "pickup.md"), PICKUP_PROMPT);
  return [`MCP server in ${file}`, `/share and /pickup in ${dir}`];
}

async function setupCodex(cmd: string[], env: Record<string, string>): Promise<string[]> {
  const home = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
  const file = path.join(home, "config.toml");
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  const done: string[] = [];
  if (/^\[mcp_servers\.relay\]/m.test(current)) {
    done.push(`MCP server already in ${file} (left unchanged)`);
  } else {
    const q = (s: string) => JSON.stringify(s);
    const envLine = Object.keys(env).length ? `env = { ${Object.entries(env).map(([k, v]) => `${k} = ${q(v)}`).join(", ")} }\n` : "";
    const block = `\n[mcp_servers.relay]\ncommand = ${q(cmd[0]!)}\nargs = [${cmd.slice(1).map(q).join(", ")}]\n${envLine}`;
    await writeText(file, current.replace(/\n*$/, "\n") + block);
    done.push(`MCP server in ${file}`);
  }
  // Codex custom prompts are user-level only.
  await writeText(path.join(home, "prompts", "share.md"), SHARE_PROMPT);
  await writeText(path.join(home, "prompts", "pickup.md"), PICKUP_PROMPT);
  done.push(`/share and /pickup in ${path.join(home, "prompts")}`);
  return done;
}

async function setupZCode(scope: "user" | "project", root: string, cmd: string[], env: Record<string, string>): Promise<string[]> {
  const base = scope === "project" ? path.join(root, ".zcode") : path.join(homedir(), ".zcode");
  const file = scope === "project" ? path.join(base, "config.json") : path.join(base, "cli", "config.json");
  const cfg = await readJson(file);
  const relay = { type: "stdio", command: cmd[0], args: cmd.slice(1), ...(Object.keys(env).length ? { env } : {}) };
  cfg.mcp = { ...cfg.mcp, servers: { ...cfg.mcp?.servers, relay } };
  await writeText(file, JSON.stringify(cfg, null, 2) + "\n");
  const dir = path.join(base, "commands");
  await writeText(path.join(dir, "share.md"), SHARE_PROMPT);
  await writeText(path.join(dir, "pickup.md"), PICKUP_PROMPT);
  return [`MCP server in ${file}`, `/share and /pickup in ${dir}`];
}

export async function setup(opts: SetupOpts): Promise<void> {
  const scope = opts.scope ?? "user";
  const wanted = (opts.tools ?? ALL_TOOLS).split(",").map((t) => t.trim()) as ToolName[];
  const root = scope === "project" ? (await repoInfo()).root : process.cwd();
  const cmd = await mcpCommand();
  const env: Record<string, string> = opts.relayConfig ? { RELAY_CONFIG: path.resolve(opts.relayConfig) } : {};

  for (const tool of wanted) {
    if (!(await installed(tool))) {
      console.log(`- ${tool}: not installed, skipped`);
      continue;
    }
    try {
      const done =
        tool === "claude"
          ? await setupClaude(scope, root, cmd, env)
          : tool === "opencode"
            ? await setupOpenCode(scope, root, cmd, env)
            : tool === "zcode"
              ? await setupZCode(scope, root, cmd, env)
              : tool === "gemini"
                ? await setupGemini(scope, root, cmd, env)
                : tool === "copilot"
                  ? await setupCopilot(scope, root, cmd, env)
                  : tool === "cursor"
                    ? await setupCursor(scope, root, cmd, env)
                    : await setupCodex(cmd, env);
      console.log(`- ${tool}: ${done.join("; ")}`);
    } catch (err) {
      console.log(`- ${tool}: ${(err as Error).message}`);
    }
  }
  if (opts.autoShare) {
    if (!["on", "off"].includes(opts.autoShare)) throw new Error('--auto-share takes "on" or "off"');
    const on = opts.autoShare === "on";
    let any = false;
    if (wanted.includes("claude") && (await installed("claude"))) {
      console.log(`- claude: ${await setupClaudeAutoShare(on, cmd, env)}`);
      any = true;
    }
    if (wanted.includes("gemini") && (await installed("gemini"))) {
      console.log(`- gemini: ${await setupClaudeAutoShare(on, cmd, env, path.join(geminiHome(), "settings.json"), "gemini")}`);
      any = true;
    }
    if (wanted.includes("copilot") && (await installed("copilot"))) {
      console.log(`- copilot: ${await setupCopilotAutoShare(on, cmd, env)}`);
      any = true;
    }
    if (!any) console.log("- auto-share works with Claude Code, Gemini CLI and Copilot CLI; none found");
  }
  console.log(`\nMCP command: ${cmd.join(" ")}\nRestart your agents, then try /share or /pickup.`);
}
