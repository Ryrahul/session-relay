import { describe, expect, it } from "vitest";
import { HIDDEN_PROMPT, hidePrompts, SessionUpload } from "./session.js";
import { newId } from "./ids.js";

describe("SessionUpload", () => {
  it("fills defaults for a minimal share", () => {
    const parsed = SessionUpload.parse({
      source: { tool: "codex", native_id: "abc" },
      repo: "github.com/acme/api",
      title: "fix flaky test",
      summary: { goal: "make e2e stable" },
      include: "summary",
    });
    expect(parsed.visibility).toEqual({ team: true, people: [] });
    expect(parsed.messages).toEqual([]);
    expect(parsed.summary.next).toEqual([]);
  });

  it("rejects unknown tools", () => {
    expect(() =>
      SessionUpload.parse({
        source: { tool: "aider", native_id: "abc" },
        repo: "r",
        title: "t",
        summary: { goal: "g" },
        include: "summary",
      }),
    ).toThrow();
  });
});

describe("newId", () => {
  it("is prefixed", () => {
    expect(newId("rs")).toMatch(/^rs_[0-9A-Z]{12}$/);
  });
});

describe("hidePrompts", () => {
  it("replaces each run of typed prompts with one marker and keeps the agent's side", () => {
    const out = hidePrompts([
      { role: "user", text: "my secret plan", at: "2026-10-25T10:00:00.000Z" },
      { role: "user", text: "and more" },
      { role: "assistant", text: "on it" },
      { role: "tool", text: "edited a.ts" },
      { role: "user", text: "thanks" },
    ]);
    expect(out).toEqual([
      { role: "user", text: HIDDEN_PROMPT, at: "2026-10-25T10:00:00.000Z" },
      { role: "assistant", text: "on it" },
      { role: "tool", text: "edited a.ts" },
      { role: "user", text: HIDDEN_PROMPT },
    ]);
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});
