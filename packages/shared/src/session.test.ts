import { describe, expect, it } from "vitest";
import { SessionUpload } from "./session.js";
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
