import { MAX_LINKS, type LinkKind, type SessionLink } from "./session.js";

/** Most links found automatically in one conversation. */
const MAX_FOUND = 20;
const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`|\\^]+/g;

/**
 * A pull request or issue URL in its plain form ("…/pull/42", no "/files" or "#comment"),
 * with its kind and short label; null for any other URL.
 * Knows GitHub (and GitHub Enterprise), GitLab, Bitbucket, Linear and Jira.
 */
export function parseLink(raw: string): { url: string; kind: LinkKind; label: string; owner?: string; host: string } | null {
  let u: URL;
  try {
    u = new URL(raw.replace(/[.,;:!?]+$/, ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.host.toLowerCase();
  const base = `${u.protocol}//${u.host}`;
  const path = u.pathname.replace(/\/+$/, "");
  let m = /^\/(.+?)\/-\/(merge_requests|issues|work_items)\/(\d+)/.exec(path);
  if (m) {
    const kind = m[2] === "merge_requests" ? "pr" : "issue";
    const repo = m[1]!;
    return { url: `${base}/${repo}/-/${m[2]}/${m[3]}`, kind, label: `${repo.split("/").slice(-2).join("/")}${kind === "pr" ? "!" : "#"}${m[3]}`, owner: repo.split("/")[0], host };
  }
  m = /^\/([^/]+)\/([^/]+)\/(pull|issues|pull-requests)\/(\d+)/.exec(path);
  if (m) {
    const kind = m[3] === "issues" ? "issue" : "pr";
    return { url: `${base}/${m[1]}/${m[2]}/${m[3]}/${m[4]}`, kind, label: `${m[1]}/${m[2]}#${m[4]}`, owner: m[1], host };
  }
  m = /^\/([^/]+)\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(path);
  if (m && host === "linear.app") return { url: `${base}/${m[1]}/issue/${m[2]}`, kind: "issue", label: m[2]!.toUpperCase(), host };
  m = /^\/browse\/([A-Z][A-Z0-9_]*-\d+)$/.exec(path);
  if (m) return { url: `${base}/browse/${m[1]}`, kind: "issue", label: m[1]!, host };
  return null;
}

/** Short text for a link: its title, else "acme/api#42", "ENG-12" or the URL without the scheme. */
export function linkLabel(link: Pick<SessionLink, "url" | "title">): string {
  return link.title || parseLink(link.url)?.label || link.url.replace(/^https?:\/\//, "");
}

/** A link from a URL someone typed: recognised PRs and issues get their plain URL and kind. */
export function toLink(url: string, title?: string): SessionLink {
  const p = parseLink(url.trim());
  return { url: p?.url ?? url.trim(), kind: p?.kind ?? "other", ...(title?.trim() ? { title: title.trim().slice(0, 200) } : {}) };
}

/**
 * Pull requests and issues mentioned in a conversation, in order of first mention.
 * For `repo` ("github.com/acme/api"), code-host links are kept only from the same host and owner,
 * so a library's issue the agent happened to read isn't listed; Linear and Jira links are always kept.
 */
export function findLinks(texts: string[], repo?: string): SessionLink[] {
  const [repoHost, repoOwner] = (repo ?? "").toLowerCase().split("/");
  const seen = new Map<string, SessionLink>();
  for (const t of texts) {
    for (const raw of t.match(URL_RE) ?? []) {
      const p = parseLink(raw);
      if (!p || seen.has(p.url)) continue;
      const codeHost = p.owner !== undefined;
      if (codeHost && repo && (p.host !== repoHost || p.owner!.toLowerCase() !== repoOwner)) continue;
      seen.set(p.url, { url: p.url, kind: p.kind });
      if (seen.size >= MAX_FOUND) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

/** One list, without duplicates, kinds read from the URLs: earlier lists win, but a title from a later one fills a gap. PRs first, then issues, then the rest. */
export function mergeLinks(...lists: (SessionLink[] | undefined)[]): SessionLink[] {
  const out = new Map<string, SessionLink>();
  for (const l of lists) {
    for (const link of l ?? []) {
      const p = parseLink(link.url);
      const key = p?.url ?? link.url;
      const have = out.get(key);
      if (!have) out.set(key, { ...link, url: key, kind: p?.kind ?? link.kind ?? "other" });
      else if (!have.title && link.title) out.set(key, { ...have, title: link.title });
    }
  }
  const order: Record<LinkKind, number> = { pr: 0, issue: 1, other: 2 };
  return [...out.values()].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, MAX_LINKS);
}
