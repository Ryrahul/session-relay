import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Message } from "@session-relay/shared";
import { isInside, samePathVariants } from "../git.js";
import { describeToolCall, isInternalTool, withOutcome, type ToolDescription } from "./describe.js";
import { jsonLines, titleFrom } from "./lines.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

/** Claude Code names each project folder after its cwd with every non-alphanumeric char replaced by "-". */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function projectsDir(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude"), "projects");
}

/** Injected context, slash-command plumbing and interruptions, not things the person typed. */
const NOISE = /^\s*(<command-(name|message|args)>|<local-command-(stdout|stderr)>|<bash-(input|stdout|stderr)>|Caveat: |\[Request interrupted)/;

function cleanUserText(text: string): string | null {
  const stripped = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!stripped || NOISE.test(stripped)) return null;
  return stripped;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? c.text : "")).join("\n");
  return "";
}

/** Parses a Claude Code JSONL transcript. Exported for fixture tests. */
export async function parseClaudeFile(file: string, fallbackCwd = ""): Promise<LocalSession> {
  const messages: Message[] = [];
  const files = new Set<string>();
  const pending = new Map<string, { index: number; d: ToolDescription }>();
  let nativeId = path.basename(file, ".jsonl");
  let cwd = fallbackCwd;
  let version: string | undefined;
  let branch: string | undefined;
  let startedAt: string | undefined;
  let title: string | undefined;

  for await (const o of jsonLines(file)) {
    if (o.type === "summary" && typeof o.summary === "string") title ??= o.summary;
    if (o.type !== "user" && o.type !== "assistant") continue;
    if (o.isSidechain || o.isMeta) continue;
    nativeId = o.sessionId ?? nativeId;
    cwd = o.cwd ?? cwd;
    version = o.version ?? version;
    branch = o.gitBranch ?? branch;
    startedAt ??= o.timestamp;
    const at: string | undefined = o.timestamp;
    const content = o.message?.content;

    if (o.type === "user") {
      if (typeof content === "string") {
        const text = cleanUserText(content);
        if (text) messages.push({ role: "user", text, at });
        continue;
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === "text") {
          const text = cleanUserText(block.text ?? "");
          if (text) messages.push({ role: "user", text, at });
        } else if (block?.type === "tool_result") {
          const p = pending.get(block.tool_use_id);
          if (!p) continue;
          const failed = block.is_error === true || block.is_error === "True";
          if (!failed) p.d.files.forEach((f) => files.add(f));
          messages[p.index] = { ...messages[p.index]!, text: withOutcome(p.d, resultText(block.content), failed) };
          pending.delete(block.tool_use_id);
        }
      }
      continue;
    }

    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === "text" && block.text?.trim()) {
        messages.push({ role: "assistant", text: block.text.trim(), at });
      } else if (block?.type === "tool_use") {
        if (isInternalTool(block.name ?? "")) continue;
        const d = describeToolCall(block.name ?? "tool", block.input ?? {}, cwd);
        pending.set(block.id, { index: messages.length, d });
        messages.push({ role: "tool", text: d.text, at });
      }
    }
  }

  // Calls still waiting for a result (session in progress) count as touched.
  for (const p of pending.values()) p.d.files.forEach((f) => files.add(f));
  title ??= titleFrom(messages.find((m) => m.role === "user")?.text ?? "");
  return { tool: "claude-code", version, nativeId, cwd, branch, title, startedAt, messages, filesTouched: [...files] };
}

async function firstUserText(file: string): Promise<{ text: string; cwd?: string }> {
  for await (const o of jsonLines(file)) {
    if (o.type !== "user" || o.isSidechain || o.isMeta) continue;
    const c = o.message?.content;
    const raw = typeof c === "string" ? c : Array.isArray(c) ? c.find((b: any) => b?.type === "text")?.text ?? "" : "";
    const text = cleanUserText(raw);
    if (text) return { text, cwd: o.cwd };
  }
  return { text: "" };
}

export const claudeAdapter: Adapter = {
  tool: "claude-code",

  async list(repoRoot) {
    let dirs: string[];
    try {
      dirs = await readdir(projectsDir());
    } catch {
      return [];
    }
    const prefixes = samePathVariants(repoRoot).map(encodeProjectDir);
    const matching = dirs.filter((d) => prefixes.some((p) => d === p || d.startsWith(p + "-")));
    const refs: SessionRef[] = [];
    for (const dir of matching) {
      const full = path.join(projectsDir(), dir);
      for (const name of await readdir(full).catch(() => [])) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(full, name);
        const { text, cwd } = await firstUserText(file);
        if (!text) continue;
        // The folder name is lossy, so confirm the real cwd is inside the repo.
        if (cwd && !samePathVariants(repoRoot).some((r) => isInside(cwd, r))) continue;
        refs.push({
          tool: "claude-code",
          nativeId: name.replace(/\.jsonl$/, ""),
          title: titleFrom(text),
          cwd: cwd ?? repoRoot,
          updatedAt: (await stat(file)).mtime,
          file,
        });
      }
    }
    return refs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  load(ref) {
    return parseClaudeFile(ref.file!, ref.cwd);
  },
};
