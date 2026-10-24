import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { encodeProjectDir, parseClaudeFile } from "./claude.js";
import { parseCodexFile } from "./codex.js";
import { describeToolCall, patchFiles } from "./describe.js";
import { parseOpenCodeExport } from "./opencode.js";
import { zcodeAdapter } from "./zcode.js";
import { copilotAdapter, parseCopilotEvents } from "./copilot.js";
import { cursorAdapter, cursorSlug, parseCursorTranscript } from "./cursor.js";
import { geminiAdapter, parseGeminiChat } from "./gemini.js";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

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

describe("ZCode adapter (ZCode's session tables)", () => {
  process.env.ZCODE_DB = path.join(FIX, "zcode/db.sqlite");

  it("lists top-level, unarchived sessions in this repo", async () => {
    const refs = await zcodeAdapter.list(ROOT);
    expect(refs.map((r) => r.nativeId)).toEqual(["ses_zc01fixadd"]);
    expect(refs[0]).toMatchObject({ tool: "zcode", cwd: ROOT, title: "Fix math.js add() and verify output" });
  });

  it("reads messages and parts like OpenCode", async () => {
    const [ref] = await zcodeAdapter.list(ROOT);
    const s = await zcodeAdapter.load(ref!);
    expect(s).toMatchObject({ tool: "zcode", nativeId: "ses_zc01fixadd", cwd: ROOT, version: "0.32.1" });
    const tools = s.messages.filter((m) => m.role === "tool").map((m) => m.text);
    expect(tools).toContain("read math.js");
    expect(tools.some((t) => /^ran `node -e .*` → 5/.test(t))).toBe(true);
    expect(s.messages[0]).toMatchObject({ role: "user" });
    expect(s.messages.at(-1)!.text).toContain("5");
    expect(s.filesTouched).toContain(`${ROOT}/math.js`);
  });

  it("returns nothing when ZCode isn't installed", async () => {
    process.env.ZCODE_DB = "/nonexistent/db.sqlite";
    expect(await zcodeAdapter.list(ROOT)).toEqual([]);
    process.env.ZCODE_DB = path.join(FIX, "zcode/db.sqlite");
  });
});

describe("Gemini CLI adapter (constructed from its record types)", async () => {
  const raw = await readFile(path.join(FIX, "gemini/session-fix-add.jsonl"), "utf8");
  const s = parseGeminiChat(raw, ROOT);

  it("replays the chat: re-appended messages, rewind, patch, title", () => {
    expect(s).toMatchObject({ tool: "gemini", nativeId: "5f1c2a9e-0b7d-4c55-9a43-1e2f3a4b5c6d", cwd: ROOT, title: "Fix add() in math.js" });
    const text = s.messages.map((m) => m.text).join("\n");
    expect(text).not.toContain("I tried a rewrite"); // rewound
    expect(text).not.toContain("Checkpoint saved"); // info message
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant", text: "Fixed math.js: add() now returns a + b. Output: 5" }); // patched
    const tools = s.messages.filter((m) => m.role === "tool").map((m) => m.text);
    expect(tools).toEqual(["read math.js", "edited math.js", 'ran `node -e "import(\'./math.js\').then(m=>console.log(m.add(2,3)))"` → 5']);
    expect(s.filesTouched).toEqual([`${ROOT}/math.js`]);
  });

  it("finds sessions by the project folder's .project_root", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "relay-gemini-"));
    const proj = path.join(home, ".gemini", "tmp", "relay-sandbox");
    await mkdir(path.join(proj, "chats"), { recursive: true });
    await writeFile(path.join(proj, ".project_root"), ROOT);
    await cp(path.join(FIX, "gemini/session-fix-add.jsonl"), path.join(proj, "chats", "session-2026-10-22T10-00-5f1c2a9e.jsonl"));
    const other = path.join(home, ".gemini", "tmp", "other");
    await mkdir(path.join(other, "chats"), { recursive: true });
    await writeFile(path.join(other, ".project_root"), "/home/dev/other");
    await cp(path.join(FIX, "gemini/session-fix-add.jsonl"), path.join(other, "chats", "session-x.jsonl"));
    process.env.GEMINI_CLI_HOME = home;
    const refs = await geminiAdapter.list(ROOT);
    expect(refs.map((r) => [r.nativeId, r.title])).toEqual([["5f1c2a9e-0b7d-4c55-9a43-1e2f3a4b5c6d", "Fix add() in math.js"]]);
    expect((await geminiAdapter.load(refs[0]!)).messages.length).toBe(s.messages.length);
    delete process.env.GEMINI_CLI_HOME;
  });
});

describe("Copilot CLI adapter (constructed from the SDK's event types)", async () => {
  const s = parseCopilotEvents(await readFile(path.join(FIX, "copilot/events.jsonl"), "utf8"));

  it("reads metadata, messages and paired tool calls", () => {
    expect(s).toMatchObject({ tool: "copilot", version: "1.0.103", nativeId: "7c3e9d2a-4f1b-4e8a-b6c5-2d1e0f9a8b7c", cwd: ROOT, branch: "main", title: "Fix add in math.js" });
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    const tools = s.messages.filter((m) => m.role === "tool").map((m) => m.text);
    expect(tools).toEqual([
      "read math.js",
      "edited math.js",
      "ran `node check.js` (failed: Cannot find module check.js)",
      'ran `node -e "import(\'./math.js\').then(m=>console.log(m.add(2,3)))"` → 5',
    ]);
    expect(s.messages.at(-1)).toMatchObject({ role: "assistant", text: "Fixed add() in math.js; the check prints 5." });
    expect(s.filesTouched).toEqual([`${ROOT}/math.js`]);
  });

  it("lists sessions whose cwd is in the repo, titled from workspace.yaml", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "relay-copilot-"));
    const dir = path.join(home, "session-state", "7c3e9d2a-4f1b-4e8a-b6c5-2d1e0f9a8b7c");
    await mkdir(dir, { recursive: true });
    await cp(path.join(FIX, "copilot/events.jsonl"), path.join(dir, "events.jsonl"));
    await cp(path.join(FIX, "copilot/workspace.yaml"), path.join(dir, "workspace.yaml"));
    process.env.COPILOT_HOME = home;
    const refs = await copilotAdapter.list(ROOT);
    expect(refs.map((r) => [r.nativeId, r.title])).toEqual([["7c3e9d2a-4f1b-4e8a-b6c5-2d1e0f9a8b7c", "Fix add() in math.js"]]);
    expect(await copilotAdapter.list("/home/dev/other")).toEqual([]);
    expect((await copilotAdapter.load(refs[0]!)).title).toBe("Fix add() in math.js");
    delete process.env.COPILOT_HOME;
  });
});

describe("Cursor adapter (experimental, agent transcripts)", async () => {
  const s = parseCursorTranscript(await readFile(path.join(FIX, "cursor/transcript.jsonl"), "utf8"), "abc123", ROOT);

  it("strips Cursor's wrappers and reads tool uses (no results)", () => {
    expect(s.messages[0]).toEqual({ role: "user", text: "math.js has a bug in add(). Fix it." });
    expect(s.messages.filter((m) => m.role === "tool").map((m) => m.text)).toEqual(["read math.js", "edited math.js", 'ran `node -e "console.log(1)"`']);
    expect(s.filesTouched).toEqual([`${ROOT}/math.js`]);
    expect(s.title).toBe("math.js has a bug in add(). Fix it.");
  });

  it("finds transcripts in the project's folder (flat and nested)", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "relay-cursor-"));
    const base = path.join(home, "projects", cursorSlug(ROOT), "agent-transcripts");
    await mkdir(path.join(base, "nested1"), { recursive: true });
    await cp(path.join(FIX, "cursor/transcript.jsonl"), path.join(base, "flat1.jsonl"));
    await cp(path.join(FIX, "cursor/transcript.jsonl"), path.join(base, "nested1", "nested1.jsonl"));
    process.env.CURSOR_HOME = home;
    expect(cursorSlug(ROOT)).toBe("home-dev-relay-sandbox");
    expect((await cursorAdapter.list(ROOT)).map((r) => r.nativeId).sort()).toEqual(["flat1", "nested1"]);
    expect(await cursorAdapter.list("/home/dev/other")).toEqual([]);
    delete process.env.CURSOR_HOME;
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
