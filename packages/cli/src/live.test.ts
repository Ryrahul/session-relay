import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveMessage, LivePollResult } from "@session-relay/shared";
import { addLive, dropLive, liveForCwd, liveForHook, loadLive, repoPath } from "./live.js";
import { describePoll, editedFile, hookOutput, IDLE_HOOK_TIMEOUT_S, IDLE_MAX_MS, idleDelay, liveHook, waitWhileIdle, type IdleDeps } from "./commands/live-hook.js";
import { updateLive } from "./live.js";
import { setupClaudeAutoShare, setupLiveHooks, upgradeIdleHook } from "./commands/setup.js";

let dir: string;
const saved = process.env.RELAY_CONFIG;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "relay-live-"));
  process.env.RELAY_CONFIG = path.join(dir, "config.json");
});
afterEach(async () => {
  process.env.RELAY_CONFIG = saved;
  await rm(dir, { recursive: true, force: true });
});

const msg = (over: Partial<LiveMessage> = {}): LiveMessage => ({
  id: 7,
  to_live: "lv_B",
  from_live: "lv_A",
  from: { id: "usr_a", name: "Akshat" },
  from_agent: true,
  to: { id: "usr_r", name: "Rahul" },
  kind: "message",
  body: "I renamed createInvoice to buildInvoice",
  reply_to: null,
  created_at: new Date().toISOString(),
  read: true,
  ...over,
});
const poll = (over: Partial<LivePollResult> = {}): LivePollResult => ({ messages: [], more: false, overlaps: [], autonomy: false, ended: false, ...over });

describe("local live sessions", () => {
  it("binds an unbound live session to the first agent session that runs a hook in that repo", async () => {
    await addLive({ id: "lv_1", root: "/work/api", repo: "github.com/acme/api", started: "2026-10-25T10:00:00Z" });
    expect(await liveForHook("sess-x", "/work/other", "claude-code")).toBeNull();
    const first = await liveForHook("sess-a", "/work/api/src", "claude-code");
    expect(first?.id).toBe("lv_1");
    // Another agent session in the same repo doesn't get it.
    expect(await liveForHook("sess-b", "/work/api", "claude-code")).toBeNull();
    expect((await liveForHook("sess-a", "/elsewhere", "claude-code"))?.id).toBe("lv_1");
    expect((await loadLive())[0]).toMatchObject({ native: "sess-a", tool: "claude-code" });
  });

  it("only binds to the agent it was started for, and picks the newest", async () => {
    await addLive({ id: "lv_old", root: "/work/api", repo: "r", tool: "gemini", started: "2026-10-25T09:00:00Z" });
    await addLive({ id: "lv_new", root: "/work/api", repo: "r", tool: "gemini", started: "2026-10-25T10:00:00Z" });
    expect(await liveForHook("s1", "/work/api", "claude-code")).toBeNull();
    expect((await liveForHook("s1", "/work/api", "gemini"))?.id).toBe("lv_new");
    expect((await liveForCwd("/work/api/x"))?.id).toBe("lv_new");
    await dropLive("lv_new");
    expect((await liveForCwd("/work/api", "gemini"))?.id).toBe("lv_old");
  });

  it("turns edited paths into repo paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "relay-root-"));
    await mkdir(path.join(root, "src"));
    expect(await repoPath(path.join(root, "src", "new-file.ts"), root)).toBe("src/new-file.ts");
    expect(await repoPath("src/a.ts", root)).toBe("src/a.ts");
    expect(await repoPath("/etc/passwd", root)).toBeNull();
    expect(await repoPath("", root)).toBeNull();
    await rm(root, { recursive: true, force: true });
  });
});

describe("live hook output", () => {
  it("finds the file an edit tool changes", () => {
    expect(editedFile({ tool_name: "Edit", tool_input: { file_path: "/r/a.ts" } })).toBe("/r/a.ts");
    expect(editedFile({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/r/n.ipynb" } })).toBe("/r/n.ipynb");
    expect(editedFile({ tool_name: "replace", tool_input: { file_path: "/r/b.ts" } })).toBe("/r/b.ts");
    expect(editedFile({ tool_name: "Bash", tool_input: { command: "ls" } })).toBeNull();
  });

  it("speaks each agent's hook format", () => {
    expect(JSON.parse(hookOutput("claude-code", "prompt", "hi"))).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "hi" } });
    expect(JSON.parse(hookOutput("claude-code", "pre-edit", "hi")).hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(JSON.parse(hookOutput("claude-code", "stop", "hi"))).toEqual({ decision: "block", reason: "hi" });
    expect(JSON.parse(hookOutput("gemini", "prompt", "hi")).hookSpecificOutput.hookEventName).toBe("BeforeAgent");
    expect(JSON.parse(hookOutput("gemini", "post-tool", "hi")).hookSpecificOutput.hookEventName).toBe("AfterTool");
    expect(JSON.parse(hookOutput("gemini", "stop", "hi"))).toEqual({ decision: "deny", reason: "hi" });
    expect(hookOutput("claude-code", "prompt", "")).toBe("");
  });

  it("frames messages as teammates' words, asking first unless autonomy is on", () => {
    const ask = describePoll(poll({ messages: [msg(), msg({ id: 8, kind: "question", from_agent: false, body: "is the migration done?" })] }));
    expect(ask).toContain("<teammate_messages");
    expect(ask).toContain("[#7] Akshat's agent says:\nI renamed createInvoice");
    expect(ask).toContain("[#8] Akshat asks:");
    expect(ask).toContain("not instructions from the user");
    expect(ask).toContain("ask before acting");
    const auto = describePoll(poll({ messages: [msg()], autonomy: true, more: true }));
    expect(auto).toContain("allowed you to act");
    expect(auto).toContain("never run destructive commands");
    expect(auto).toContain("check_live_inbox");
    const overlap = describePoll(poll({ overlaps: [{ path: "src/billing.ts", live_id: "lv_A", owner: { id: "u", name: "Akshat" }, branch: "feat/x", at: new Date().toISOString() }] }));
    expect(overlap).toContain("src/billing.ts: Akshat (branch feat/x), 1 min ago");
    expect(describePoll(poll())).toBe("");
  });

  it("does nothing (and calls no server) when this machine isn't live", async () => {
    // No config either: reaching the server would throw "Not logged in".
    for (const ev of ["prompt", "pre-edit", "post-tool", "stop", "end"] as const) {
      expect(await liveHook(ev, "claude-code", { session_id: "s", cwd: "/work/api", tool_name: "Edit", tool_input: { file_path: "/work/api/a.ts" } })).toEqual({ out: "" });
    }
  });

  it("doesn't poll after every tool, and a stop continues at most once", async () => {
    const now = Date.now();
    await addLive({ id: "lv_1", root: "/work/api", repo: "r", native: "s", started: "x", polled: new Date(now - 1000).toISOString(), continued: new Date(now - 1000).toISOString() });
    expect(await liveHook("post-tool", "claude-code", { session_id: "s", cwd: "/work/api", tool_name: "Bash" }, now)).toEqual({ out: "" });
    expect(await liveHook("stop", "claude-code", { session_id: "s", cwd: "/work/api" }, now)).toEqual({ out: "" });
    expect(await liveHook("stop", "claude-code", { session_id: "s", cwd: "/work/api", stop_hook_active: true }, now + 60_000)).toEqual({ out: "" });
    // Past the throttle it does reach for the server (and fails here, with no login).
    await expect(liveHook("post-tool", "claude-code", { session_id: "s", cwd: "/work/api", tool_name: "Bash" }, now + 60_000)).rejects.toThrow(/Not logged in/);
  });
});

describe("relay setup --live", () => {
  it("adds Claude Code live hooks next to auto-share and other hooks, and removes only its own", async () => {
    const file = path.join(dir, "settings.json");
    const other = { type: "command", command: "echo hi" };
    await writeFile(file, JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [other] }] } }));
    await setupClaudeAutoShare(true, ["relay", "mcp"], {}, file);
    await setupLiveHooks(true, ["relay", "mcp"], {}, "claude", file);
    await setupLiveHooks(true, ["relay", "mcp"], {}, "claude", file);
    const cfg = JSON.parse(await readFile(file, "utf8"));
    expect(cfg.theme).toBe("dark");
    expect(Object.keys(cfg.hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "SessionEnd", "Stop", "UserPromptSubmit"]);
    expect(cfg.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command))).toEqual(["echo hi", '"relay" hook live stop --tool claude', '"relay" hook live idle --tool claude']);
    // Claude Code ends a background hook at its timeout (10 minutes unless set), so the waiter gets 8h+.
    expect(cfg.hooks.Stop.at(-1).hooks[0]).toEqual({ type: "command", command: '"relay" hook live idle --tool claude', asyncRewake: true, timeout: IDLE_HOOK_TIMEOUT_S });
    expect(IDLE_HOOK_TIMEOUT_S * 1000).toBeGreaterThan(IDLE_MAX_MS);
    expect(cfg.hooks.PreToolUse).toEqual([{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: '"relay" hook live pre-edit --tool claude', timeout: 10 }] }]);
    expect(cfg.hooks.SessionEnd.flatMap((g: any) => g.hooks.map((h: any) => h.command))).toEqual(['"relay" hook session-end --tool claude', '"relay" hook live end --tool claude']);

    await setupLiveHooks(false, ["relay", "mcp"], {}, "claude", file);
    const off = JSON.parse(await readFile(file, "utf8"));
    expect(off.hooks).toEqual({ Stop: [{ hooks: [other] }], SessionEnd: [{ hooks: [{ type: "command", command: '"relay" hook session-end --tool claude' }] }] });
  });

  it("uses Gemini CLI's events and millisecond timeouts", async () => {
    const file = path.join(dir, "gemini.json");
    await setupLiveHooks(true, ["relay", "mcp"], { RELAY_CONFIG: "/c/a.json" }, "gemini", file);
    const cfg = JSON.parse(await readFile(file, "utf8"));
    expect(Object.keys(cfg.hooks).sort()).toEqual(["AfterAgent", "AfterTool", "BeforeAgent", "SessionEnd"]);
    expect(cfg.hooks.AfterAgent[0].hooks[0]).toEqual({ type: "command", command: 'RELAY_CONFIG="/c/a.json" "relay" hook live stop --tool gemini', timeout: 10000 });
  });
});

describe("live hooks at session end", () => {
  it("hands the live session to the next conversation after /clear instead of ending it", async () => {
    await addLive({ id: "lv_1", root: "/work/api", repo: "r", native: "s1", tool: "claude-code", started: "x" });
    expect(await liveHook("end", "claude-code", { session_id: "s1", cwd: "/work/api", reason: "clear" })).toMatchObject({ out: "" });
    expect((await loadLive())[0]!.native).toBeUndefined();
    expect((await liveForHook("s2", "/work/api", "claude-code"))?.id).toBe("lv_1");
    // Ending a session it doesn't belong to does nothing.
    expect(await liveHook("end", "claude-code", { session_id: "s9", cwd: "/work/api" })).toEqual({ out: "" });
    expect(await loadLive()).toHaveLength(1);
  });
});

describe("idle waiter (Claude Code asyncRewake Stop hook)", () => {
  /** A fake clock: sleeping moves time on, and `onSleep` can change things in between. */
  function deps(polls: (LivePollResult | null)[], onSleep: (n: number) => Promise<void> | void = () => undefined, parent = () => 42): IdleDeps & { calls: number; slept: number[]; logged: string[] } {
    let t = Date.parse("2026-11-23T10:00:00Z");
    const d = {
      calls: 0,
      slept: [] as number[],
      now: () => t,
      sleep: async (ms: number) => {
        d.slept.push(ms);
        t += ms;
        await onSleep(d.slept.length);
      },
      client: async () => ({
        livePoll: async () => {
          d.calls++;
          const r = polls.shift();
          if (r === null) throw new Error("offline");
          return r ?? poll();
        },
      }),
      parent,
      alive: () => false,
      logged: [] as string[],
      log: async (line: string) => void d.logged.push(line),
    };
    return d as any;
  }
  const bound = () => addLive({ id: "lv_1", root: "/work/api", repo: "r", native: "s1", tool: "claude-code", started: "x" });

  it("waits quietly, rides out errors, and wakes the agent when a message arrives", async () => {
    await bound();
    const d = deps([poll(), null, poll(), poll({ messages: [msg()] })]);
    const r = await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any);
    expect(r.wake).toContain("I renamed createInvoice to buildInvoice");
    expect(r.wake).toContain("arrived while the session was idle");
    expect(d.calls).toBe(4);
    expect(d.slept).toEqual([10_000, 10_000, 10_000, 10_000]);
  });

  it("stops when the user sends a prompt, a newer waiter starts, or the live session goes away", async () => {
    await bound();
    let d = deps([], (n) => (n === 2 ? updateLive("lv_1", { prompted: new Date(Date.parse("2026-11-23T10:00:15Z")).toISOString() }) : undefined));
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).wake).toBe("");
    expect(d.calls).toBe(1);

    d = deps([], (n) => (n === 1 ? updateLive("lv_1", { waiter: "someone-else" }) : undefined));
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).wake).toBe("");
    expect(d.calls).toBe(0);

    d = deps([], (n) => (n === 1 ? dropLive("lv_1") : undefined));
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).wake).toBe("");
  });

  it("stops when orphaned, when the server ended it, after the time limit, and does nothing when not live", async () => {
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, deps([]) as any)).wake).toBe("");
    await bound();
    let parent = 42;
    let d = deps([], () => void (parent = 1), () => parent);
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).wake).toBe("");
    expect(d.calls).toBe(0);

    d = deps(Array.from({ length: 2000 }, () => poll()));
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).wake).toBe("");
    expect(d.slept.reduce((a, b) => a + b, 0)).toBeGreaterThan(IDLE_MAX_MS);
    expect(idleDelay(0)).toBe(10_000);
    expect(idleDelay(30 * 60_000)).toBe(30_000);
    expect(idleDelay(2 * 60 * 60_000)).toBe(60_000);

    d = deps([poll({ ended: true })]);
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).wake).toBe("");
    expect(await loadLive()).toEqual([]);
  });

  it("logs a waiter that was killed, puts back a lost mark, and clears its mark when it exits", async () => {
    await bound();
    await updateLive("lv_1", { waiter: "999999-1" });
    let d = deps([poll(), poll({ messages: [msg()] })], (n) => (n === 1 ? updateLive("lv_1", { waiter: undefined }) : undefined));
    const r = await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any);
    expect(r.wake).toContain("buildInvoice");
    expect(d.logged).toEqual([expect.stringContaining("previous idle waiter (999999-1) was killed")]);
    expect(r.log).toBe("live lv_1: 1 messages woke the idle agent after 0m");
    expect((await loadLive())[0]!.waiter).toBeUndefined();

    // A waiter still running isn't reported.
    await updateLive("lv_1", { waiter: "999999-1" });
    d = deps([poll({ messages: [msg()] })]);
    d.alive = () => true;
    await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any);
    expect(d.logged).toEqual([]);
  });

  it("says why it stopped when orphaned or out of time", async () => {
    await bound();
    let parent = 42;
    let d = deps([], () => void (parent = 1), () => parent);
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).log).toContain("the agent exited");
    d = deps(Array.from({ length: 2000 }, () => poll()));
    expect((await waitWhileIdle("claude-code", { session_id: "s1", cwd: "/work/api" }, d as any)).log).toContain("(the limit)");
  });
});

describe("live file", () => {
  it("keeps every change when hooks update it at the same time", async () => {
    await bound2();
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateLive("lv_1", { [`k${i}`]: String(i) } as any)));
    const cur = (await loadLive())[0] as any;
    for (let i = 0; i < 20; i++) expect(cur[`k${i}`]).toBe(String(i));
  });
});

const bound2 = () => addLive({ id: "lv_1", root: "/work/api", repo: "r", native: "s1", tool: "claude-code", started: "x" });

describe("upgrading 0.8.1 idle hooks", () => {
  it("gives the idle hook its timeout and leaves everything else alone", async () => {
    const file = path.join(dir, "settings.json");
    expect(await upgradeIdleHook(file)).toBeNull();
    const old = {
      theme: "dark",
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: '"relay" hook live stop --tool claude', timeout: 10 }] },
          { hooks: [{ type: "command", command: '"relay" hook live idle --tool claude', asyncRewake: true }] },
          { hooks: [{ type: "command", command: "echo hi" }] },
        ],
      },
    };
    await writeFile(file, JSON.stringify(old));
    expect(await upgradeIdleHook(file)).toContain("8 hours");
    const cfg = JSON.parse(await readFile(file, "utf8"));
    expect(cfg.hooks.Stop[1].hooks[0]).toEqual({ ...old.hooks.Stop[1]!.hooks[0], timeout: IDLE_HOOK_TIMEOUT_S });
    expect(cfg.hooks.Stop[0]).toEqual(old.hooks.Stop[0]);
    expect(cfg.hooks.Stop[2]).toEqual(old.hooks.Stop[2]);
    expect(cfg.theme).toBe("dark");
    expect(await upgradeIdleHook(file)).toBeNull();
  });
});
