import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Message } from "@session-relay/shared";
import { isInside, samePathVariants } from "../git.js";
import { describeToolCall, isInternalTool, withOutcome } from "./describe.js";
import { titleFrom } from "./lines.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

/** ~/.gemini, or $GEMINI_CLI_HOME/.gemini (that variable replaces the home folder). */
export const geminiDir = () => path.join(process.env.GEMINI_CLI_HOME ?? homedir(), ".gemini");

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
};

interface Folded {
  meta: { sessionId?: string; startTime?: string; lastUpdated?: string; summary?: string; directories?: string[] };
  messages: any[];
}

/**
 * Replays a chat file the way Gemini CLI does: messages are re-appended when they change
 * (keep the last copy, in first-seen order), `$set` updates metadata, `$patch` edits or
 * reorders messages, `$rewindTo` drops a message and everything after it.
 */
export function foldGeminiChat(raw: string): Folded {
  // Older versions wrote one JSON object instead of JSONL.
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{") && !trimmed.includes("\n{")) {
    try {
      const whole = JSON.parse(trimmed);
      if (Array.isArray(whole.messages)) return { meta: whole, messages: whole.messages };
    } catch {
      // not a single object; fall through to JSONL
    }
  }
  const meta: Folded["meta"] = {};
  const byId = new Map<string, any>();
  const patchOne = (p: any) => {
    const m = byId.get(p.id);
    if (!m) return;
    if (p.content !== undefined) m.content = p.content;
    if (Array.isArray(p.toolCalls) && Array.isArray(m.toolCalls)) {
      for (const tp of p.toolCalls) {
        const tc = m.toolCalls.find((t: any) => t.id === tp.id);
        if (tc) Object.assign(tc, tp);
      }
    }
  };
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== "object") continue;
    if (typeof r.$rewindTo === "string") {
      const ids = [...byId.keys()];
      const at = ids.indexOf(r.$rewindTo);
      if (at === -1) byId.clear();
      else for (const id of ids.slice(at)) byId.delete(id);
    } else if (r.$patch && typeof r.$patch === "object") {
      const p = r.$patch;
      if (typeof p.id === "string") patchOne(p);
      for (const u of Array.isArray(p.updates) ? p.updates : []) if (typeof u?.id === "string") patchOne(u);
      for (const id of Array.isArray(p.removeIds) ? p.removeIds : []) byId.delete(id);
      if (Array.isArray(p.orderIds)) {
        const ordered = p.orderIds.filter((id: unknown) => typeof id === "string" && byId.has(id));
        const rest = [...byId.keys()].filter((id) => !ordered.includes(id));
        const entries = [...rest, ...ordered].map((id) => [id, byId.get(id)] as const);
        byId.clear();
        for (const [id, m] of entries) byId.set(id, m);
      }
    } else if (r.$set && typeof r.$set === "object") {
      if (Array.isArray(r.$set.messages)) {
        byId.clear();
        for (const m of r.$set.messages) if (typeof m?.id === "string") byId.set(m.id, m);
      }
      const { messages: _m, ...rest } = r.$set;
      Object.assign(meta, rest);
    } else if (typeof r.id === "string") {
      byId.set(r.id, r);
    } else if (typeof r.sessionId === "string") {
      Object.assign(meta, r);
    }
  }
  return { meta, messages: [...byId.values()] };
}

/** Turns folded Gemini records into the common message shape. Exported for fixture tests. */
export function parseGeminiChat(raw: string, cwd: string): LocalSession {
  const { meta, messages: records } = foldGeminiChat(raw);
  const messages: Message[] = [];
  const files = new Set<string>();
  for (const m of records) {
    const at = typeof m.timestamp === "string" ? m.timestamp : undefined;
    if (m.type === "user") {
      const text = textOf(m.displayContent ?? m.content).trim();
      if (text && !text.startsWith("/")) messages.push({ role: "user", text, at });
    } else if (m.type === "gemini") {
      const text = textOf(m.content).trim();
      if (text) messages.push({ role: "assistant", text, at });
      for (const tc of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
        if (isInternalTool(tc.name ?? "")) continue;
        const d = describeToolCall(tc.name ?? "tool", tc.args ?? {}, cwd);
        const failed = tc.status === "error";
        if (!failed && tc.status !== "cancelled") d.files.forEach((f) => files.add(f));
        const out = typeof tc.resultDisplay === "string" ? tc.resultDisplay : undefined;
        messages.push({ role: "tool", text: withOutcome(d, out, failed), at: tc.timestamp ?? at });
      }
    }
  }
  return {
    tool: "gemini",
    nativeId: meta.sessionId ?? "",
    cwd,
    title: meta.summary || titleFrom(messages.find((m) => m.role === "user")?.text ?? ""),
    startedAt: meta.startTime,
    messages,
    filesTouched: [...files].map((f) => (path.isAbsolute(f) ? f : path.join(cwd, f))),
  };
}

/** Project folders under ~/.gemini/tmp with the absolute path each one belongs to. */
async function projectDirs(): Promise<{ dir: string; root: string }[]> {
  const tmp = path.join(geminiDir(), "tmp");
  let names: string[];
  try {
    names = await readdir(tmp);
  } catch {
    return [];
  }
  const out: { dir: string; root: string }[] = [];
  for (const name of names) {
    const dir = path.join(tmp, name);
    const root = await readFile(path.join(dir, ".project_root"), "utf8").then((s) => s.trim(), () => "");
    out.push({ dir, root });
  }
  return out;
}

async function chatFiles(dir: string): Promise<string[]> {
  const chats = path.join(dir, "chats");
  const names = await readdir(chats).catch(() => [] as string[]);
  // Subagent chats live in subfolders; only top-level sessions are listed.
  return names.filter((n) => n.startsWith("session-") && (n.endsWith(".jsonl") || n.endsWith(".json"))).map((n) => path.join(chats, n));
}

export const geminiAdapter: Adapter = {
  tool: "gemini",

  async list(repoRoot) {
    const roots = samePathVariants(repoRoot);
    // Older Gemini CLI versions named the folder sha256(project root) and had no .project_root.
    const hashes = new Set(roots.map((r) => createHash("sha256").update(r).digest("hex")));
    const refs: SessionRef[] = [];
    for (const { dir, root } of await projectDirs()) {
      const match = root ? roots.some((r) => isInside(root, r)) : hashes.has(path.basename(dir));
      if (!match) continue;
      const cwd = root || repoRoot;
      for (const file of await chatFiles(dir)) {
        try {
          const raw = await readFile(file, "utf8");
          const s = parseGeminiChat(raw, cwd);
          if (!s.nativeId || !s.messages.length) continue;
          refs.push({ tool: "gemini", nativeId: s.nativeId, title: s.title || "Untitled session", cwd, updatedAt: (await stat(file)).mtime, file });
        } catch {
          // unreadable or half-written file
        }
      }
    }
    return refs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 50);
  },

  async load(ref) {
    if (!ref.file) throw new Error(`Gemini session ${ref.nativeId} has no file`);
    return parseGeminiChat(await readFile(ref.file, "utf8"), ref.cwd);
  },
};
