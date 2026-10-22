import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { encodeProjectDir, parseClaudeFile } from "./claude.js";
import { parseCodexFile } from "./codex.js";
import { describeToolCall, patchFiles } from "./describe.js";
import { parseOpenCodeExport } from "./opencode.js";

const FIX = fileURLToPath(new URL("../../../../fixtures", import.meta.url));
const ROOT = "/home/dev/relay-sandbox";

describe("Claude Code adapter (real 2.1 session)", async () => {
  const s = await parseClaudeFile(path.join(FIX, "claude-code/fix-add.jsonl"));

  it("reads metadata", () => {
    expect(s).toMatchObject({ tool: "claude-code", cwd: ROOT, branch: "main", version: "2.1.308" });
    expect(s.nativeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.title).toMatch(/^math\.js has a bug in add\(\)/);
  });

  it("keeps the conversation and drops injected context", () => {
    const text = s.messages.map((m) => m.text).join("\n");
    expect(text).not.toContain("SYSTEM CONTEXT");
    expect(text).not.toContain("system-reminder");
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant" });
    expect(s.messages.at(-1)!.text).toContain("5");
  });

  it("summarises tool calls with outcomes", () => {
    const tools = s.messages.filter((m) => m.role === "tool").map((m) => m.text);
    expect(tools[0]).toBe("read math.js");
    expect(tools[1]).toBe("edited math.js");
    expect(tools[2]).toMatch(/^ran `node -e .*` → 5$/);
    expect(s.filesTouched).toEqual([`${ROOT}/math.js`]);
  });

  it("encodes project folders like Claude Code", () => {
    expect(encodeProjectDir("/Users/a.b/my_app")).toBe("-Users-a-b-my-app");
  });
});

describe("OpenCode adapter (real 1.19 export)", async () => {
  const data = JSON.parse(await readFile(path.join(FIX, "opencode/fix-add.export.json"), "utf8"));
  const s = parseOpenCodeExport(data);

  it("reads metadata and title", () => {
    expect(s).toMatchObject({ tool: "opencode", cwd: ROOT, title: "Fix math.js add() and verify output" });
    expect(s.nativeId).toMatch(/^ses_/);
  });

  it("keeps text, skips reasoning, summarises tools", () => {
    const text = s.messages.map((m) => m.text).join("\n");
    expect(text).not.toContain("Inspecting progress");
    const tools = s.messages.filter((m) => m.role === "tool").map((m) => m.text);
    expect(tools).toContain("read math.js");
    expect(tools.some((t) => t.startsWith("patched math.js"))).toBe(true);
    expect(tools.some((t) => /^ran `node -e .*` → 5/.test(t))).toBe(true);
    expect(s.messages.at(-1)!.text).toContain("5");
    expect(s.filesTouched).toContain(`${ROOT}/math.js`);
  });
});

describe("Codex adapter (constructed rollout)", async () => {
  const s = await parseCodexFile(path.join(FIX, "codex/fix-add.rollout.jsonl"));

  it("uses the clean event stream for text", () => {
    expect(s).toMatchObject({ tool: "codex", cwd: ROOT, branch: "main", version: "0.145.0" });
    const text = s.messages.map((m) => m.text).join("\n");
    expect(text).not.toContain("SYSTEM");
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("summarises exec, apply_patch and shell calls", () => {
    const tools = s.messages.filter((m) => m.role === "tool").map((m) => m.text);
    expect(tools[0]).toMatch(/^ran `cat math.js` → export function add/);
    expect(tools[1]).toBe("patched math.js");
    expect(tools[2]).toBe("ran `node -e \"import('./math.js').then(m=>console.log(m.add(2,3)))\"` → 5");
    expect(s.filesTouched).toEqual([`${ROOT}/math.js`]);
  });
});

describe("describeToolCall", () => {
  it("handles names from all three tools", () => {
    expect(describeToolCall("Bash", { command: "npm test" }, "/r").text).toBe("ran `npm test`");
    expect(describeToolCall("bash", { command: "ls" }, "/r").text).toBe("ran `ls`");
    expect(describeToolCall("shell", { command: ["bash", "-lc", "make"] }, "/r").text).toBe("ran `make`");
    expect(describeToolCall("Write", { file_path: "/r/a/b.ts" }, "/r")).toMatchObject({ text: "wrote a/b.ts", files: ["/r/a/b.ts"] });
    expect(describeToolCall("edit", { filePath: "/r/x.ts" }, "/r").text).toBe("edited x.ts");
    expect(describeToolCall("mcp__thing__do", {}, "/r").text).toBe("used mcp__thing__do");
  });

  it("finds files in patches", () => {
    expect(patchFiles("*** Begin Patch\n*** Add File: a.ts\n*** Delete File: b.ts\n*** End Patch")).toEqual(["a.ts", "b.ts"]);
  });
});

describe("failed and internal tool calls", () => {
  it("does not count files from failed writes and skips internal tools", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "relay-claude-"));
    const base = { sessionId: "s1", cwd: ROOT, timestamp: "2026-10-22T10:00:00Z" };
    const lines = [
      { ...base, type: "user", message: { role: "user", content: "add multiply" } },
      { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: `${ROOT}/math.js` } }] } },
      { ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "permission denied" }] } },
      { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "ToolSearch", input: {} }] } },
      { ...base, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: `${ROOT}/b.js` } }] } },
      { ...base, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: "ok" }] } },
    ];
    const file = path.join(dir, "s1.jsonl");
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n"));
    const s = await parseClaudeFile(file);
    await rm(dir, { recursive: true, force: true });
    expect(s.filesTouched).toEqual([`${ROOT}/b.js`]);
    expect(s.messages.map((m) => m.text)).toEqual(["add multiply", "wrote math.js (failed: permission denied)", "edited b.js"]);
  });
});
