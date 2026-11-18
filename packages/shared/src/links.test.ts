import { describe, expect, it } from "vitest";
import { findLinks, linkLabel, mergeLinks, parseLink, toLink } from "./links.js";

describe("parseLink", () => {
  it("reads pull requests and issues from code hosts and trackers", () => {
    expect(parseLink("https://github.com/acme/api/pull/42/files#diff-1")).toMatchObject({ url: "https://github.com/acme/api/pull/42", kind: "pr", label: "acme/api#42" });
    expect(parseLink("https://github.com/acme/api/issues/7#issuecomment-9).")).toMatchObject({ url: "https://github.com/acme/api/issues/7", kind: "issue" });
    expect(parseLink("https://gitlab.com/grp/sub/app/-/merge_requests/3")).toMatchObject({ kind: "pr", label: "sub/app!3", owner: "grp" });
    expect(parseLink("https://bitbucket.org/ws/repo/pull-requests/5/overview")).toMatchObject({ url: "https://bitbucket.org/ws/repo/pull-requests/5", kind: "pr" });
    expect(parseLink("https://linear.app/acme/issue/ENG-12/fix-retries")).toMatchObject({ url: "https://linear.app/acme/issue/ENG-12", label: "ENG-12" });
    expect(parseLink("https://acme.atlassian.net/browse/PAY-301")).toMatchObject({ kind: "issue", label: "PAY-301" });
    expect(parseLink("https://github.com/acme/api/pulls")).toBeNull();
    expect(parseLink("https://example.com/docs")).toBeNull();
    expect(parseLink("not a url")).toBeNull();
  });
});

describe("findLinks", () => {
  const texts = [
    "Opened https://github.com/acme/api/pull/42.",
    "see https://github.com/acme/api/pull/42/files and https://github.com/acme/web/issues/3",
    "upstream bug: https://github.com/honojs/hono/issues/999",
    "tracked in https://linear.app/acme/issue/ENG-12",
  ];
  it("keeps this owner's links and tracker issues, once each", () => {
    expect(findLinks(texts, "github.com/acme/api").map((l) => l.url)).toEqual([
      "https://github.com/acme/api/pull/42",
      "https://github.com/acme/web/issues/3",
      "https://linear.app/acme/issue/ENG-12",
    ]);
  });
  it("keeps every code-host link without a repo", () => {
    expect(findLinks(texts)).toHaveLength(4);
  });
});

describe("mergeLinks", () => {
  it("dedupes by plain URL, fills titles, puts PRs first", () => {
    const merged = mergeLinks(
      [{ url: "https://github.com/acme/api/issues/7", kind: "issue" }],
      [toLink("https://github.com/acme/api/issues/7#x", "Retries"), toLink("https://github.com/acme/api/pull/9/")],
    );
    expect(merged).toEqual([
      { url: "https://github.com/acme/api/pull/9", kind: "pr" },
      { url: "https://github.com/acme/api/issues/7", kind: "issue", title: "Retries" },
    ]);
    expect(linkLabel(merged[0]!)).toBe("acme/api#9");
    expect(linkLabel(merged[1]!)).toBe("Retries");
    expect(toLink("https://example.com/spec").kind).toBe("other");
  });
});
