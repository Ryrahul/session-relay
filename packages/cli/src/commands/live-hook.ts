import { renderLiveMessages, renderOverlaps, type LivePollResult, type SourceTool } from "@session-relay/shared";
import { RelayClient } from "../client.js";
import { dropLive, liveForHook, repoPath, updateLive, type LocalLive } from "../live.js";

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
  await updateLive(live.id, patch);
  return { out: hookOutput(tool, event, text), log: text ? `live ${live.id}: ${r.messages.length} messages, ${r.overlaps.length} overlaps (${event})` : undefined };
}
