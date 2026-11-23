import { appendFile } from "node:fs/promises";
import path from "node:path";
import { renderLiveMessages, renderOverlaps, type LivePollResult, type SourceTool } from "@session-relay/shared";
import { RelayClient } from "../client.js";
import { configPath } from "../config.js";
import { dropLive, liveForHook, loadLive, repoPath, updateLive, type LocalLive } from "../live.js";

/**
 * Live hooks: between an agent's steps, take teammates' messages and warn about files a teammate
 * is editing. They run on every prompt and tool call, so they return at once when you aren't
 * live, never block the agent for long, and never fail it.
 */

/** What the agent ran: our event names, mapped from each agent's own. */
export type LiveEvent = "prompt" | "pre-edit" | "post-tool" | "stop" | "end";

interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
  /** SessionEnd: why it ended ("clear", "logout", "prompt_input_exit", …). */
  reason?: string;
}

/** Tool hooks talk to the server at most this often; prompts, edits and stops always do. */
const TOOL_POLL_MS = 15_000;
/** A stop hook makes the agent continue at most once in this window. */
const CONTINUE_GAP_MS = 20_000;
/** Server calls from hooks give up after this. */
const HOOK_TIMEOUT_MS = 4_000;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "write_file", "replace"]);

/** The file an edit tool is about to change (or changed). */
export function editedFile(input: HookInput): string | null {
  if (!input.tool_name || !EDIT_TOOLS.has(input.tool_name)) return null;
  const t = input.tool_input ?? {};
  const f = t.file_path ?? t.notebook_path ?? t.absolute_path ?? t.path;
  return typeof f === "string" ? f : null;
}

/** Hook output in the agent's format: extra context, or (at a stop) a reason to keep going. */
export function hookOutput(tool: SourceTool, event: LiveEvent, text: string): string {
  if (!text) return "";
  if (event === "stop") return JSON.stringify(tool === "gemini" ? { decision: "deny", reason: text } : { decision: "block", reason: text });
  const names: Record<string, Partial<Record<LiveEvent, string>>> = {
    "claude-code": { prompt: "UserPromptSubmit", "pre-edit": "PreToolUse", "post-tool": "PostToolUse" },
    gemini: { prompt: "BeforeAgent", "post-tool": "AfterTool" },
  };
  const hookEventName = names[tool]?.[event];
  if (!hookEventName) return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } });
}

/** The text for a poll result, or "" when there's nothing to say. */
export function describePoll(r: LivePollResult): string {
  return [renderOverlaps(r.overlaps), renderLiveMessages(r.messages, { autonomy: r.autonomy, more: r.more })].filter(Boolean).join("\n\n");
}

/** Runs one live hook and returns what to print (possibly nothing). */
export async function liveHook(event: LiveEvent, tool: SourceTool, input: HookInput, now = Date.now()): Promise<{ out: string; log?: string }> {
  const live = await liveForHook(input.session_id, input.cwd ?? process.cwd(), tool);
  if (!live) return { out: "" };

  if (event === "end") {
    if (live.native !== input.session_id) return { out: "" };
    // /clear starts a new conversation in the same place: hand the live session over to it.
    if (input.reason === "clear") {
      await updateLive(live.id, { native: undefined });
      return { out: "", log: `live ${live.id} handed over after /clear` };
    }
    const client = await RelayClient.fromConfig();
    await client.liveEnd(live.id).catch(() => undefined);
    await dropLive(live.id);
    return { out: "", log: `live ${live.id} ended with the agent session` };
  }

  const since = (iso?: string) => (iso ? now - new Date(iso).getTime() : Infinity);
  // Claude Code reports edits before they happen (pre-edit); Gemini CLI only after (post-tool).
  const reportsEdit = event === "pre-edit" || (event === "post-tool" && tool !== "claude-code");
  const edited = reportsEdit ? editedFile(input) : null;
  if (event === "post-tool" && !edited && since(live.polled) < TOOL_POLL_MS) return { out: "" };
  if (event === "stop" && (input.stop_hook_active || since(live.continued) < CONTINUE_GAP_MS)) return { out: "" };

  const file = edited ? await repoPath(edited, live.root) : null;
  const client = await RelayClient.fromConfig();
  const r = await client.livePoll(live.id, { files: file ? [file] : [] }, HOOK_TIMEOUT_MS);
  const patch: Partial<LocalLive> = { polled: new Date(now).toISOString() };

  if (r.ended) {
    await dropLive(live.id);
    const note = "Your Session Relay live session has ended (stopped, ended by an admin, or idle for 12 hours). Teammates' messages won't arrive any more; start again with /live.";
    return { out: event === "prompt" ? hookOutput(tool, event, note) : "", log: `live ${live.id} ended on the server` };
  }
  const text = describePoll(r);
  if (event === "stop" && text) patch.continued = patch.polled;
  if (event === "prompt") patch.prompted = patch.polled;
  await updateLive(live.id, patch);
  return { out: hookOutput(tool, event, text), log: text ? `live ${live.id}: ${r.messages.length} messages, ${r.overlaps.length} overlaps (${event})` : undefined };
}

/** How long an idle waiter sleeps between checks: often at first, less after a while. */
export function idleDelay(elapsedMs: number): number {
  if (elapsedMs < 10 * 60_000) return 10_000;
  if (elapsedMs < 60 * 60_000) return 30_000;
  return 60_000;
}

/** An idle waiter gives up after this; the next turn starts a new one. */
export const IDLE_MAX_MS = 8 * 60 * 60_000;
/**
 * The timeout `relay setup` gives the idle hook, in seconds. Claude Code ends a background hook at
 * its timeout (10 minutes when none is set), so it has to outlast IDLE_MAX_MS.
 */
export const IDLE_HOOK_TIMEOUT_S = IDLE_MAX_MS / 1000 + 600;

export interface IdleDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  client: () => Promise<Pick<RelayClient, "livePoll">>;
  /** The process that started the hook; a different one means the agent exited (we were orphaned). */
  parent: () => number;
  /** Whether a process is still running, to notice a waiter that was killed. */
  alive: (pid: number) => boolean;
  /** Writes a line to hook.log straight away (the waiter itself may be killed later). */
  log: (line: string) => Promise<void>;
}

const realDeps: IdleDeps = {
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  client: () => RelayClient.fromConfig(),
  parent: () => process.ppid,
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  log: (line) => appendFile(path.join(path.dirname(configPath()), "hook.log"), `${new Date().toISOString()} ${line}\n`).catch(() => undefined),
};

/** The waiter running in this process, for a log line if it is killed. */
export let armedWaiter: { live: string; start: number } | null = null;

const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`;

/**
 * Claude Code's async "rewake" Stop hook: after the agent finishes a turn it waits in the background
 * for teammates' messages. Hooks only run while the agent works, so without this an idle session
 * would see nothing until its user typed. Returns the text to wake the agent with, or "" to exit
 * quietly: when the user sends a prompt (the turn's own hooks take over), a newer waiter starts,
 * the live session ends, the agent quits, or after IDLE_MAX_MS. Its polls also keep the session from showing as away.
 * Unusual exits go to hook.log, and so does a waiter that died without exiting (killed by its timeout).
 */
export async function waitWhileIdle(tool: SourceTool, input: HookInput, deps: IdleDeps = realDeps): Promise<{ wake: string; log?: string }> {
  const live = await liveForHook(input.session_id, input.cwd ?? process.cwd(), tool);
  if (!live) return { wake: "" };
  const start = deps.now();
  const parent = deps.parent();
  const me = `${process.pid}-${start}`;
  // A waiter clears its mark when it exits, so one still here whose process is gone was killed.
  const prev = live.waiter ? Number(live.waiter.split("-")[0]) : NaN;
  if (prev && prev !== process.pid && !deps.alive(prev)) {
    await deps.log(`live ${live.id}: the previous idle waiter (${live.waiter}) was killed while waiting; if this keeps happening, rerun relay setup --live on`);
  }
  await updateLive(live.id, { waiter: me });
  armedWaiter = { live: live.id, start };
  const done = async (wake: string, why?: string) => {
    armedWaiter = null;
    // Clear our mark unless a newer waiter took over.
    const cur = (await loadLive()).find((l) => l.id === live.id);
    if (cur?.waiter === me) await updateLive(live.id, { waiter: undefined });
    return { wake, log: why ? `live ${live.id}: ${why}` : undefined };
  };
  const client = await deps.client();
  for (;;) {
    await deps.sleep(idleDelay(deps.now() - start));
    const waited = minutes(deps.now() - start);
    // Orphaned (the agent quit) or too old: stop, so no message is taken that nobody will see.
    if (deps.now() - start > IDLE_MAX_MS) return done("", `idle waiter stopped after ${waited} (the limit); the next turn starts a new one`);
    if (deps.parent() !== parent) return done("", `idle waiter stopped after ${waited}: the agent exited`);
    const cur = (await loadLive()).find((l) => l.id === live.id);
    if (!cur) return done("");
    // A newer waiter (a newer stop) owns the session. If our mark was lost, put it back.
    if (cur.waiter && cur.waiter !== me) return done("");
    if (!cur.waiter) await updateLive(live.id, { waiter: me });
    if (cur.prompted && new Date(cur.prompted).getTime() > start) return done("");
    const r = await client.livePoll(live.id, {}, HOOK_TIMEOUT_MS).catch(() => null);
    if (!r) continue;
    if (r.ended) {
      await dropLive(live.id);
      return done("", "ended on the server (idle waiter)");
    }
    const text = describePoll(r);
    if (text) {
      await updateLive(live.id, { polled: new Date(deps.now()).toISOString() });
      return done(
        `${text}\n\n(This arrived while the session was idle. Tell the user now, and follow the instructions above about asking before acting.)`,
        `${r.messages.length} messages woke the idle agent after ${waited}`,
      );
    }
  }
}
