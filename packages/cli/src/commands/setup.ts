import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { repoInfo } from "../git.js";

const run = promisify(execFile);

export const SHARE_PROMPT = `---
description: Share this session with your team (Session Relay)
---
Share this session with the team using the relay MCP tool \`share_current_session\`.

First write a handoff for a teammate who will continue this work, based on this conversation:
- goal: what we are trying to achieve, in one or two sentences
- decisions: key decisions made and why
- done: what is finished
- next: concrete next steps
- open_questions: anything unresolved
Never include secrets, tokens or passwords.

Then call \`share_current_session\` with those fields. If this session continued a teammate's shared session you loaded earlier, it is linked automatically; if the work is unrelated, pass \`continues: "none"\`. Extra instructions from the user (title, who should see it, "full transcript"): $ARGUMENTS

Reply with the share id and title only.
`;

export const PICKUP_PROMPT = `---
description: Load a teammate's shared session and continue it (Session Relay)
---
Load a teammate's shared session and continue it. Request: $ARGUMENTS

Use the relay MCP tools: \`search_sessions\` or \`list_sessions\` to find the best match for this repo, then \`get_session\` with mode "tail".
Read the goal, decisions, next steps and recent conversation. Check the current state of the code (git status, the files touched) before changing anything.
Then say in a few lines where things stand and continue with the first next step.
`;

type ToolName = "claude" | "opencode" | "codex";

interface SetupOpts {
  tools?: string;
  scope?: "user" | "project";
  /** Point the MCP server at a specific relay config file (testing, several accounts). */
  relayConfig?: string;
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

export async function setup(opts: SetupOpts): Promise<void> {
  const scope = opts.scope ?? "user";
  const wanted = (opts.tools ?? "claude,opencode,codex").split(",").map((t) => t.trim()) as ToolName[];
  const root = scope === "project" ? (await repoInfo()).root : process.cwd();
  const cmd = await mcpCommand();
  const env: Record<string, string> = opts.relayConfig ? { RELAY_CONFIG: path.resolve(opts.relayConfig) } : {};

  for (const tool of wanted) {
    const bin = tool === "claude" ? "claude" : tool;
    if (!(await has(bin))) {
      console.log(`- ${tool}: not installed, skipped`);
      continue;
    }
    try {
      const done =
        tool === "claude"
          ? await setupClaude(scope, root, cmd, env)
          : tool === "opencode"
            ? await setupOpenCode(scope, root, cmd, env)
            : await setupCodex(cmd, env);
      console.log(`- ${tool}: ${done.join("; ")}`);
    } catch (err) {
      console.log(`- ${tool}: ${(err as Error).message}`);
    }
  }
  console.log(`\nMCP command: ${cmd.join(" ")}\nRestart your agents, then try /share or /pickup.`);
}
