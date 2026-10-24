import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Message } from "@session-relay/shared";
import { isInside, samePathVariants } from "../git.js";
import { describeToolCall, isInternalTool, withOutcome } from "./describe.js";
import { titleFrom } from "./lines.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

/** $COPILOT_HOME, default ~/.copilot. Each session is session-state/<id>/events.jsonl. */
export const copilotDir = () => process.env.COPILOT_HOME ?? path.join(homedir(), ".copilot");

const args = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }
  return {};
};

/** `name:` from workspace.yaml, the session's title in Copilot's UI. */
function yamlName(yaml: string): string | undefined {
  const m = /^name:\s*(.+)$/m.exec(yaml);
  return m ? m[1]!.trim().replace(/^["']|["']$/g, "") || undefined : undefined;
}

/** Parses Copilot CLI's events.jsonl (the event types in github/copilot-sdk). Exported for fixture tests. */
export function parseCopilotEvents(raw: string, name?: string): LocalSession {
  const messages: Message[] = [];
  const files = new Set<string>();
  let sessionId = "";
  let version: string | undefined;
  let cwd = "";
  let branch: string | undefined;
  let startedAt: string | undefined;
  let title = name;
  // Tool calls are written as start + complete, paired by toolCallId; the line goes where the call started.
  const pending = new Map<string, { index: number; name: string; input: Record<string, unknown> }>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const d = e?.data ?? {};
    const at = typeof e?.timestamp === "string" ? e.timestamp : undefined;
    switch (e?.type) {
      case "session.start":
        sessionId = d.sessionId ?? sessionId;
        version = d.copilotVersion ?? version;
        cwd = d.context?.cwd ?? cwd;
        branch = d.context?.branch ?? branch;
        startedAt = d.startTime ?? at;
        break;
      case "session.title_changed":
        if (typeof d.title === "string" && !name) title = d.title;
        break;
      case "user.message":
        if (typeof d.content === "string" && d.content.trim()) messages.push({ role: "user", text: d.content.trim(), at });
        break;
      case "assistant.message":
        if (typeof d.content === "string" && d.content.trim()) messages.push({ role: "assistant", text: d.content.trim(), at });
        break;
      case "tool.execution_start": {
        const toolName = d.toolName ?? "tool";
        if (isInternalTool(toolName)) break;
        const input = args(d.arguments);
        messages.push({ role: "tool", text: describeToolCall(toolName, input, cwd).text, at });
        pending.set(d.toolCallId, { index: messages.length - 1, name: toolName, input });
        break;
      }
      case "tool.execution_complete": {
        const p = pending.get(d.toolCallId);
        if (!p) break;
        pending.delete(d.toolCallId);
        const desc = describeToolCall(p.name, p.input, cwd);
        const failed = d.success === false;
        if (!failed) desc.files.forEach((f) => files.add(f));
        const out = failed ? d.error?.message : typeof d.result?.content === "string" ? d.result.content : undefined;
        messages[p.index] = { ...messages[p.index]!, text: withOutcome(desc, out, failed) };
        break;
      }
    }
  }
  return {
    tool: "copilot",
    version,
    nativeId: sessionId,
    cwd,
    branch,
    title: title || titleFrom(messages.find((m) => m.role === "user")?.text ?? ""),
    startedAt,
    messages,
    filesTouched: [...files].map((f) => (path.isAbsolute(f) || !cwd ? f : path.join(cwd, f))),
  };
}

/** The cwd from the session.start event, read from the top of the file. */
async function startCwd(file: string): Promise<string | undefined> {
  const raw = await readFile(file, "utf8");
  for (const line of raw.split("\n").slice(0, 20)) {
    try {
      const e = JSON.parse(line);
      if (e?.type === "session.start") return e.data?.context?.cwd;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

export const copilotAdapter: Adapter = {
  tool: "copilot",

  async list(repoRoot) {
    const base = path.join(copilotDir(), "session-state");
    const ids = await readdir(base).catch(() => [] as string[]);
    const roots = samePathVariants(repoRoot);
    const refs: SessionRef[] = [];
    for (const id of ids) {
      const file = path.join(base, id, "events.jsonl");
      try {
        const cwd = await startCwd(file);
        if (!cwd || !roots.some((r) => isInside(cwd, r))) continue;
        const name = yamlName(await readFile(path.join(base, id, "workspace.yaml"), "utf8").catch(() => ""));
        const s = parseCopilotEvents(await readFile(file, "utf8"), name);
        if (!s.messages.length) continue;
        refs.push({ tool: "copilot", nativeId: s.nativeId || id, title: s.title || "Untitled session", cwd, updatedAt: (await stat(file)).mtime, file });
      } catch {
        // missing or half-written session
      }
    }
    return refs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 50);
  },

  async load(ref) {
    if (!ref.file) throw new Error(`Copilot session ${ref.nativeId} has no file`);
    const name = yamlName(await readFile(path.join(path.dirname(ref.file), "workspace.yaml"), "utf8").catch(() => ""));
    const s = parseCopilotEvents(await readFile(ref.file, "utf8"), name);
    return { ...s, nativeId: s.nativeId || ref.nativeId, cwd: s.cwd || ref.cwd };
  },
};
