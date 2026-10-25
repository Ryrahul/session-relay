import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SourceTool } from "@session-relay/shared";
import { findSessions } from "../adapters/index.js";
import { RelayClient } from "../client.js";
import { configPath } from "../config.js";
import { repoInfo } from "../git.js";
import { prepareShare, uploadShare } from "../share.js";
import { liveHook, type LiveEvent } from "./live-hook.js";

/** Below this many messages a session isn't worth a draft. */
const MIN_MESSAGES = 4;

interface HookInput {
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  reason?: string;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function log(line: string) {
  const file = path.join(path.dirname(configPath()), "hook.log");
  await mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  await appendFile(file, `${new Date().toISOString()} ${line}\n`).catch(() => undefined);
}

/**
 * Saves the session that just ended as a private draft. Runs from an agent's session-end hook,
 * so it never fails loudly: problems go to hook.log next to the relay config.
 */
export async function sessionEnd(opts: { tool: string }): Promise<string> {
  const tool: SourceTool = opts.tool === "claude" ? "claude-code" : (opts.tool as SourceTool);
  const input: HookInput = JSON.parse((await readStdin()) || "{}");
  const nativeId = input.session_id ?? input.sessionId;
  const cwd = input.cwd ?? process.cwd();
  if (!nativeId) return "no session id in hook input";

  const repo = await repoInfo(cwd).catch(() => null);
  if (!repo) return `skipped ${nativeId}: ${cwd} is not a git repo`;
  const client = await RelayClient.fromConfig().catch(() => null);
  if (!client) return "skipped: not logged in";

  const refs = await findSessions(repo.root, tool);
  const ref = refs.find((r) => r.nativeId === nativeId);
  if (!ref) return `skipped ${nativeId}: session not found in ${repo.root}`;

  const prepared = await prepareShare(client, { cwd: repo.root, ref, include: "summary+tail", people: [], continues: undefined });
  if (prepared.built.session.messages.length < MIN_MESSAGES) return `skipped ${nativeId}: only ${prepared.built.session.messages.length} messages`;

  // Already shared (or drafted) this session: shared ones are left alone, an older draft is replaced.
  // Look up both the hook's id and the one the share records, in case a tool reports them differently.
  const ids = [...new Set([nativeId, prepared.built.session.source.native_id])];
  const found = await Promise.all(ids.map((n) => client.list({ native_id: n, author: "me", drafts: "include", limit: 20 })));
  const sessions = found.flatMap((f) => f.sessions);
  if (sessions.some((s) => !s.draft)) return `skipped ${nativeId}: already shared`;
  // Private to the author until published.
  prepared.built.session.draft = true;
  prepared.built.session.visibility = { team: false, people: [] };
  const { id } = await uploadShare(client, prepared);
  for (const old of sessions) await client.remove(old.id).catch(() => undefined);
  return `draft ${id} for ${tool} ${nativeId} (${repo.repo})${sessions.length ? `, replaced ${sessions.map((s) => s.id).join(", ")}` : ""}`;
}

const LIVE_EVENTS = new Set<LiveEvent>(["prompt", "pre-edit", "post-tool", "stop", "end"]);

/** relay hook live <event>: see live-hook.ts. */
async function live(event: string, opts: { tool: string }): Promise<void> {
  if (!LIVE_EVENTS.has(event as LiveEvent)) throw new Error(`unknown live hook event "${event}"`);
  const tool: SourceTool = opts.tool === "claude" ? "claude-code" : (opts.tool as SourceTool);
  const input = JSON.parse((await readStdin()) || "{}");
  const { out, log: line } = await liveHook(event as LiveEvent, tool, input);
  if (out) process.stdout.write(out + "\n");
  if (line) await log(line);
}

export async function hook(event: string, sub: string | undefined, opts: { tool: string }): Promise<void> {
  try {
    if (event === "live") await live(sub ?? "", opts);
    else if (event === "session-end") await log(await sessionEnd(opts));
    else throw new Error(`unknown hook event "${event}"`);
  } catch (err) {
    await log(`error (${event}${sub ? " " + sub : ""}): ${(err as Error).message}`);
  }
  // Hooks must never break the agent.
  process.exitCode = 0;
}
