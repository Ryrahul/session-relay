import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export interface RepoInfo {
  root: string;
  /** Normalised remote ("github.com/acme/api"), or "local/<folder>" without one. */
  repo: string;
  branch?: string;
  commit?: string;
}

/** "git@github.com:acme/api.git" and "https://user:tok@github.com/acme/api" both become "github.com/acme/api". */
export function normaliseRemote(url: string): string {
  let s = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const scp = /^[\w.-]+@([^:]+):(.+)$/.exec(s);
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
  s = s.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "");
  return s.toLowerCase();
}

export async function repoInfo(cwd = process.cwd()): Promise<RepoInfo> {
  const top = await git(cwd, "rev-parse", "--show-toplevel");
  if (!top) throw new Error("Not inside a git repository. Run relay from your project folder.");
  const root = await realpath(top);
  const remote = await git(root, "remote", "get-url", "origin");
  const branch = await git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const commit = await git(root, "rev-parse", "--short", "HEAD");
  return {
    root,
    repo: remote ? normaliseRemote(remote) : `local/${path.basename(root)}`,
    branch: branch && branch !== "HEAD" ? branch : undefined,
    commit: commit ?? undefined,
  };
}

/** True when `p` is `root` or inside it. */
export function isInside(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Same path, but macOS reports /tmp as /private/tmp in some places and not others. */
export function samePathVariants(p: string): string[] {
  const out = new Set([p]);
  if (p.startsWith("/private/")) out.add(p.slice("/private".length));
  else if (/^\/(tmp|var)\//.test(p)) out.add("/private" + p);
  return [...out];
}

/** The open pull request for the current branch, via the GitHub CLI. Undefined when gh is missing or there is none. */
export async function currentPr(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("gh", ["pr", "view", "--json", "url", "-q", ".url"], { cwd, timeout: 8000 });
    const url = stdout.trim();
    return /^https?:\/\//.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}
