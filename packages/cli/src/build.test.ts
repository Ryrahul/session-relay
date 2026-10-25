import { describe, expect, it } from "vitest";
import type { LocalSession } from "./adapters/types.js";
import { buildShare } from "./build.js";
import { normaliseRemote } from "./git.js";
import { renderHandoff } from "@session-relay/shared";

const local: LocalSession = {
  tool: "claude-code",
  version: "2.1",
  nativeId: "abc",
  cwd: "/home/dev/app/packages/api",
  title: "fix webhook retry",
  messages: [
    { role: "user", text: "fix /home/dev/app/packages/api/src/hook.ts, key is sk_live_" + "a".repeat(24) },
    ...Array.from({ length: 50 }, (_, i) => ({ role: "assistant" as const, text: `step ${i}` })),
  ],
  filesTouched: ["/home/dev/app/packages/api/src/hook.ts", "/home/dev/app/README.md"],
};
const repo = { root: "/home/dev/app", repo: "github.com/acme/app", branch: "main", commit: "abc1234" };

describe("buildShare", () => {
  it("keeps a tail, makes paths relative and redacts", () => {
    const { session, transcript, redactions } = buildShare(local, repo, { include: "summary+tail" });
    expect(session.messages).toHaveLength(30);
    expect(session.messages.at(-1)!.text).toBe("step 49");
    expect(session.files_touched).toEqual(["README.md", "packages/api/src/hook.ts"]);
    expect(session.summary.goal).toBe("fix src/hook.ts, key is [REDACTED:stripe-key]");
    expect(session.redactions).toBe(2); // first message (scanned, outside the tail) and the summary goal
    expect(redactions["stripe-key"]).toBe(2);
    expect(transcript).toBeUndefined();
  });

  it("sends everything for full, nothing for summary", () => {
    expect(buildShare(local, repo, { include: "full" }).transcript).toHaveLength(51);
    expect(buildShare(local, repo, { include: "summary" }).session.messages).toEqual([]);
  });

  it("uses the agent summary when given", () => {
    const { session } = buildShare(local, repo, {
      include: "summary",
      summary: { goal: "retry hooks", decisions: ["backoff 2^n"], done: [], next: ["load test"], open_questions: [] },
    });
    expect(session.summary.decisions).toEqual(["backoff 2^n"]);
  });
  it("leaves the typed prompts out of messages, transcript, title and goal", () => {
    const built = buildShare({ ...local, title: "fix /home/dev/app/packages/api/src/hook.ts" }, repo, { include: "full", hidePrompts: true });
    const all = JSON.stringify(built);
    expect(all).not.toContain("hook.ts, key");
    expect(built.session.title).toBe("Session on main");
    expect(built.session.summary.goal).toBe("");
    expect(built.transcript![0]).toEqual({ role: "user", text: "(prompt not shared)" });
    expect(built.transcript).toHaveLength(51);
    expect(built.promptsHidden).toBe(true);
    const withSummary = buildShare(local, repo, { include: "summary", hidePrompts: true, summary: { goal: "Make webhook retries safe", decisions: [], done: [], next: [], open_questions: [], sections: [] } });
    expect(withSummary.session.title).toBe("Make webhook retries safe");
    expect(buildShare(local, repo, { include: "summary", hidePrompts: true, title: "mine" }).session.title).toBe("mine");
  });
});

describe("normaliseRemote", () => {
  it.each([
    ["git@github.com:Acme/App.git", "github.com/acme/app"],
    ["https://github.com/acme/app.git", "github.com/acme/app"],
    ["https://user:tok@gitlab.com/acme/app/", "gitlab.com/acme/app"],
    ["ssh://git@github.com/acme/app.git", "github.com/acme/app"],
  ])("%s", (input, out) => expect(normaliseRemote(input)).toBe(out));
});

describe("renderHandoff", () => {
  it("renders summary and conversation", () => {
    const md = renderHandoff({
      id: "rs_1",
      org_id: "org_1",
      author: { id: "u", name: "Alice" },
      source: { tool: "opencode", native_id: "x" },
      repo: "github.com/acme/app",
      branch: "main",
      title: "fix retry",
      summary: { goal: "retry", decisions: ["d1"], done: [], next: ["n1"], open_questions: [] },
      files_touched: ["a.ts"],
      messages: [{ role: "user", text: "hi" }, { role: "tool", text: "ran `ls`" }],
      include: "summary+tail",
      visibility: { team: true, people: [] },
      redactions: 0,
      has_full_transcript: false,
      created_at: "2026-10-22T10:00:00.000Z",
      expires_at: null,
      people: [],
      message_total: 12,
      message_offset: 10,
      chain: [
        { id: "rs_a", title: "start retry work", tool: "claude-code", author: { id: "u1", name: "Alice" }, created_at: "2026-10-22T09:00:00.000Z" },
      ],
      continued_by: [],
    });
    expect(md).toContain("# fix retry");
    expect(md).toContain("Shared by **Alice** from OpenCode");
    expect(md).toContain("## Next steps\n- n1");
    expect(md).toContain("messages 11–12 of 12");
    expect(md).toContain("> _tool:_ ran `ls`");
    expect(md).toContain('Continues "start retry work" (Alice, `rs_a`)');
  });
});
