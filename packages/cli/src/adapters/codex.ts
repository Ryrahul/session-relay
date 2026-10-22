import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Message } from "@session-relay/shared";
import { isInside, samePathVariants } from "../git.js";
import { describeToolCall, isInternalTool, withOutcome, type ToolDescription } from "./describe.js";
import { jsonLines, titleFrom } from "./lines.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

const MAX_FILES_SCANNED = 400;

function sessionsDir(): string {
  return path.join(process.env.CODEX_HOME ?? path.join(homedir(), ".codex"), "sessions");
}

function parseArgs(v: unknown): Record<string, unknown> {
  if (typeof v !== "string") return (v as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(v);
  } catch {
    return { input: v };
  }
}

/** Codex wraps some outputs as JSON `{ output, metadata: { exit_code } }`. */
function unwrapOutput(v: unknown): { text: string; failed: boolean } {
  if (typeof v !== "string") return { text: "", failed: false };
  try {
    const o = JSON.parse(v);
    if (o && typeof o === "object" && "output" in o) {
      return { text: String(o.output ?? ""), failed: Number(o.metadata?.exit_code ?? 0) !== 0 };
    }
  } catch {
    // plain text output
  }
  return { text: v, failed: false };
}

/** Parses a Codex rollout JSONL file. Exported for fixture tests. */
export async function parseCodexFile(file: string): Promise<LocalSession> {
  const messages: Message[] = [];
  const files = new Set<string>();
  const pending = new Map<string, { index: number; d: ToolDescription }>();
  let nativeId = path.basename(file, ".jsonl");
  let cwd = "";
  let version: string | undefined;
  let branch: string | undefined;
  let startedAt: string | undefined;

  for await (const o of jsonLines(file)) {
    const p = o.payload ?? {};
    const at: string | undefined = o.timestamp;
    if (o.type === "session_meta") {
      nativeId = p.id ?? nativeId;
      cwd = p.cwd ?? cwd;
      version = p.cli_version ?? version;
      branch = p.git?.branch ?? branch;
      startedAt = p.timestamp ?? at;
    } else if (o.type === "turn_context") {
      cwd ||= p.cwd ?? "";
    } else if (o.type === "event_msg") {
      // The event stream carries exactly what the person typed and what the agent said,
      // without the injected instructions found in response_item messages.
      if (p.type === "user_message" && p.message?.trim()) messages.push({ role: "user", text: p.message.trim(), at });
      if (p.type === "agent_message" && p.message?.trim()) messages.push({ role: "assistant", text: p.message.trim(), at });
    } else if (o.type === "response_item") {
      if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
        const input = p.type === "local_shell_call" ? { command: p.action?.command } : parseArgs(p.arguments ?? p.input);
        const name = p.type === "local_shell_call" ? "shell" : p.name ?? "tool";
        if (isInternalTool(name)) continue;
        const d = describeToolCall(name, input, cwd);
        if (p.call_id) pending.set(p.call_id, { index: messages.length, d });
        messages.push({ role: "tool", text: d.text, at });
      } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
        const pend = pending.get(p.call_id);
        if (!pend) continue;
        const out = unwrapOutput(typeof p.output === "string" ? p.output : p.output?.content);
        if (!out.failed) pend.d.files.forEach((f) => files.add(f));
        messages[pend.index] = { ...messages[pend.index]!, text: withOutcome(pend.d, out.text, out.failed) };
        pending.delete(p.call_id);
      }
    }
  }

  for (const p of pending.values()) p.d.files.forEach((f) => files.add(f));
  return {
    tool: "codex",
    version,
    nativeId,
    cwd,
    branch,
    title: titleFrom(messages.find((m) => m.role === "user")?.text ?? ""),
    startedAt,
    messages,
    filesTouched: [...files],
  };
}

async function newestRollouts(): Promise<string[]> {
  const out: string[] = [];
  const desc = (xs: string[]) => xs.sort().reverse();
  const root = sessionsDir();
  for (const y of desc(await readdir(root).catch(() => []))) {
    for (const m of desc(await readdir(path.join(root, y)).catch(() => []))) {
      for (const d of desc(await readdir(path.join(root, y, m)).catch(() => []))) {
        const dir = path.join(root, y, m, d);
        for (const f of desc(await readdir(dir).catch(() => []))) {
          if (f.startsWith("rollout-") && f.endsWith(".jsonl")) out.push(path.join(dir, f));
          if (out.length >= MAX_FILES_SCANNED) return out;
        }
      }
    }
  }
  return out;
}

async function peek(file: string): Promise<{ id?: string; cwd?: string; title?: string }> {
  let id: string | undefined;
  let cwd: string | undefined;
  for await (const o of jsonLines(file)) {
    if (o.type === "session_meta") ({ id, cwd } = o.payload ?? {});
    if (o.type === "event_msg" && o.payload?.type === "user_message" && o.payload.message?.trim()) {
      return { id, cwd, title: titleFrom(o.payload.message) };
    }
  }
  return { id, cwd };
}

export const codexAdapter: Adapter = {
  tool: "codex",

  async list(repoRoot) {
    const roots = samePathVariants(repoRoot);
    const refs: SessionRef[] = [];
    for (const file of await newestRollouts()) {
      const { id, cwd, title } = await peek(file);
      if (!cwd || !title || !roots.some((r) => isInside(cwd, r))) continue;
      refs.push({ tool: "codex", nativeId: id ?? path.basename(file), title, cwd, updatedAt: (await stat(file)).mtime, file });
    }
    return refs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  load(ref) {
    return parseCodexFile(ref.file!);
  },
};
