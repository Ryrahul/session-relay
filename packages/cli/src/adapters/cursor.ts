import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Message } from "@session-relay/shared";
import { describeToolCall, isInternalTool } from "./describe.js";
import { titleFrom } from "./lines.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

/**
 * Cursor (experimental). Reads the agent transcripts Cursor's CLI and editor agent write under
 * ~/.cursor/projects/<folder>/agent-transcripts. Cursor's format isn't documented and has no
 * tool results or per-message times, so tool lines say what was done but not the outcome.
 */
export const cursorDir = () => process.env.CURSOR_HOME ?? path.join(homedir(), ".cursor");

/** "/Users/a/my.app" → "Users-a-my-app", the folder name Cursor uses for a project. */
export const cursorSlug = (p: string) => p.replace(/[/\\.:]/g, "-").replace(/^-+/, "");

/** Cursor wraps prompts in tags like <user_query> and adds <timestamp>; keep only the words. */
function cleanUserText(text: string): string {
  return text
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, "")
    .replace(/<\/?user_query>/g, "")
    .replace(/<(attached_files|additional_data|system_reminder)>[\s\S]*?<\/\1>/g, "")
    .trim();
}

/** Parses one agent-transcript JSONL file. Exported for fixture tests. */
export function parseCursorTranscript(raw: string, id: string, cwd: string): LocalSession {
  const messages: Message[] = [];
  const files = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const role = r?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = r.message?.content ?? r.content;
    const parts: any[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const p of parts) {
      if (p?.type === "text" && typeof p.text === "string") {
        const text = role === "user" ? cleanUserText(p.text) : p.text.trim();
        if (text) messages.push({ role, text });
      } else if (p?.type === "tool_use" && role === "assistant") {
        if (isInternalTool(p.name ?? "")) continue;
        const d = describeToolCall(p.name ?? "tool", p.input ?? {}, cwd);
        d.files.forEach((f) => files.add(f));
        messages.push({ role: "tool", text: d.text });
      }
    }
  }
  return {
    tool: "cursor",
    nativeId: id,
    cwd,
    title: titleFrom(messages.find((m) => m.role === "user")?.text ?? ""),
    messages,
    filesTouched: [...files].map((f) => (path.isAbsolute(f) ? f : path.join(cwd, f))),
  };
}

/** Transcript files in a project folder: flat <id>.jsonl, or <id>/<id>.jsonl / <id>/transcript.jsonl. */
async function transcripts(dir: string): Promise<{ id: string; file: string }[]> {
  const base = path.join(dir, "agent-transcripts");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const out: { id: string; file: string }[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".jsonl")) out.push({ id: e.name.slice(0, -6), file: path.join(base, e.name) });
    else if (e.isDirectory()) {
      for (const name of [`${e.name}.jsonl`, "transcript.jsonl"]) {
        const file = path.join(base, e.name, name);
        if (await stat(file).then((s) => s.isFile(), () => false)) {
          out.push({ id: e.name, file });
          break;
        }
      }
    }
  }
  return out;
}

export const cursorAdapter: Adapter = {
  tool: "cursor",

  async list(repoRoot) {
    const projects = path.join(cursorDir(), "projects");
    const names = await readdir(projects).catch(() => [] as string[]);
    const slug = cursorSlug(repoRoot);
    const refs: SessionRef[] = [];
    // The folder name is lossy ("-" can be "/" or "."), so match the repo and its subfolders.
    for (const name of names.filter((n) => n === slug || n.startsWith(slug + "-"))) {
      for (const { id, file } of await transcripts(path.join(projects, name))) {
        try {
          const s = parseCursorTranscript(await readFile(file, "utf8"), id, repoRoot);
          if (!s.messages.length) continue;
          refs.push({ tool: "cursor", nativeId: id, title: s.title || "Untitled session", cwd: repoRoot, updatedAt: (await stat(file)).mtime, file });
        } catch {
          // unreadable
        }
      }
    }
    return refs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 50);
  },

  async load(ref) {
    if (!ref.file) throw new Error(`Cursor session ${ref.nativeId} has no file`);
    return parseCursorTranscript(await readFile(ref.file, "utf8"), ref.nativeId, ref.cwd);
  },
};
