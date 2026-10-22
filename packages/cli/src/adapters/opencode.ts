import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Message } from "@session-relay/shared";
import { isInside, samePathVariants } from "../git.js";
import { describeToolCall, isInternalTool, withOutcome } from "./describe.js";
import { titleFrom } from "./lines.js";
import type { Adapter, LocalSession, SessionRef } from "./types.js";

const run = promisify(execFile);
const bin = () => process.env.OPENCODE_BIN ?? "opencode";

/** Parses `opencode export <id>` output. Exported for fixture tests. */
export function parseOpenCodeExport(data: any): LocalSession {
  const info = data.info ?? {};
  const cwd: string = info.directory ?? "";
  const messages: Message[] = [];
  const files = new Set<string>();

  for (const m of data.messages ?? []) {
    const role = m.info?.role === "user" ? "user" : "assistant";
    const created = m.info?.time?.created;
    const at = typeof created === "number" ? new Date(created).toISOString() : undefined;
    for (const p of m.parts ?? []) {
      if (p.type === "text" && !p.synthetic && !p.ignored && p.text?.trim()) {
        messages.push({ role, text: p.text.trim(), at });
      } else if (p.type === "file" && role === "user") {
        messages.push({ role: "user", text: `attached ${p.filename ?? "a file"}`, at });
      } else if (p.type === "tool") {
        const state = p.state ?? {};
        if (isInternalTool(p.tool ?? "")) continue;
        const d = describeToolCall(p.tool ?? "tool", state.input ?? {}, cwd);
        if (state.status !== "error") d.files.forEach((f) => files.add(f));
        messages.push({ role: "tool", text: withOutcome(d, state.output ?? state.error, state.status === "error"), at });
      } else if (p.type === "patch") {
        for (const f of p.files ?? []) files.add(f);
      }
    }
  }

  const created = info.time?.created;
  return {
    tool: "opencode",
    version: info.version,
    nativeId: info.id,
    cwd,
    title: info.title || titleFrom(messages.find((m) => m.role === "user")?.text ?? ""),
    startedAt: typeof created === "number" ? new Date(created).toISOString() : undefined,
    messages,
    filesTouched: [...files],
  };
}

export const openCodeAdapter: Adapter = {
  tool: "opencode",

  async list(repoRoot) {
    let stdout: string;
    try {
      ({ stdout } = await run(bin(), ["session", "list", "--format", "json", "-n", "50"], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 }));
    } catch {
      return []; // OpenCode not installed, or no sessions yet.
    }
    let rows: any[];
    try {
      rows = JSON.parse(stdout);
    } catch {
      return [];
    }
    const roots = samePathVariants(repoRoot);
    return rows
      .filter((r) => typeof r.directory === "string" && roots.some((root) => isInside(r.directory, root)))
      .map((r) => ({
        tool: "opencode" as const,
        nativeId: r.id,
        title: r.title || "Untitled session",
        cwd: r.directory,
        updatedAt: new Date(r.updated ?? r.created ?? 0),
      }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  async load(ref: SessionRef) {
    const { stdout } = await run(bin(), ["export", ref.nativeId], { cwd: ref.cwd, maxBuffer: 256 * 1024 * 1024 });
    // Some versions print a progress line before the JSON.
    const start = stdout.indexOf("{");
    if (start < 0) throw new Error(`opencode export ${ref.nativeId} returned no JSON`);
    return parseOpenCodeExport(JSON.parse(stdout.slice(start)));
  },
};
