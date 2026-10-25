import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * CLI config. The server URL is never hardcoded, so the same CLI works against
 * a self-hosted server or a hosted one.
 */
export interface CliConfig {
  server: string;
  token: string;
  /** Leave your typed prompts out of everything you share (relay config prompts hide). */
  hide_prompts?: boolean;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RELAY_CONFIG) return env.RELAY_CONFIG;
  const base = env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(base, "session-relay", "config.json");
}

export async function readConfig(file = configPath()): Promise<CliConfig | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as CliConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeConfig(config: CliConfig, file = configPath()): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(file, 0o600);
}

/** Changes some settings and keeps the rest. */
export async function updateConfig(patch: Partial<CliConfig>, file = configPath()): Promise<CliConfig> {
  const current = await readConfig(file);
  if (!current) throw new Error("Not logged in. Run: relay login --server <url>");
  const next = { ...current, ...patch };
  await writeConfig(next, file);
  return next;
}

/** Env vars win over the file, which is handy in CI and for testing. */
export async function resolveConfig(): Promise<CliConfig | null> {
  const file = await readConfig();
  const server = process.env.RELAY_SERVER ?? file?.server;
  const token = process.env.RELAY_TOKEN ?? file?.token;
  return server && token ? { server, token } : null;
}
