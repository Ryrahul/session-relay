import path from "node:path";
import type { IncludeMode, Message, SessionLink, SessionUpload, Summary, Visibility, RedactionHit } from "@session-relay/shared";
import { findLinks, hidePrompts, mergeLinks } from "@session-relay/shared";
import type { LocalSession } from "./adapters/types.js";
import type { RepoInfo } from "./git.js";
import { createRedactor } from "@session-relay/shared";

export const DEFAULT_TAIL = 150;
/** The tail also stops at this many characters (about 40k tokens), so a pickup stays readable. */
export const TAIL_CHARS = 150_000;
const MAX_MESSAGE_CHARS = 8000;

/** The most recent messages: at most `n`, and no more than TAIL_CHARS of text (always at least one). */
export function takeTail(messages: Message[], n: number, maxChars = TAIL_CHARS): Message[] {
  let chars = 0;
  let start = messages.length;
  while (start > 0 && messages.length - start < n) {
    chars += messages[start - 1]!.text.length;
    if (chars > maxChars && start < messages.length) break;
    start--;
  }
  return messages.slice(start);
}

export interface BuildOptions {
  include: IncludeMode;
  tail?: number;
  summary?: Summary;
  title?: string;
  visibility?: Visibility;
  redactionPatterns?: string[];
  /** Leave the user's typed prompts out: a marker takes their place, and no title or goal is taken from them. */
  hidePrompts?: boolean;
  /** Pull requests and issues to link, besides the ones found in the conversation. */
  links?: SessionLink[];
}

export interface BuiltShare {
  session: SessionUpload;
  transcript?: Message[];
  /** Uncommitted changes, redacted (only when asked for). */
  diff?: string;
  diffTruncated?: boolean;
  /** Where secrets were removed, with redacted context (first 500). */
  hits: RedactionHit[];
  redactions: Record<string, number>;
  /** The user's typed prompts were left out. */
  promptsHidden: boolean;
}

function relativeTo(root: string, p: string): string {
  if (!path.isAbsolute(p)) return p;
  const r = path.relative(root, p);
  return r.startsWith("..") ? path.basename(p) : r;
}

/** Without an agent-written summary, use the first request and the last answer. */
export function fallbackSummary(messages: Message[]): Summary {
  const firstUser = messages.find((m) => m.role === "user")?.text ?? "";
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant")?.text;
  return {
    goal: firstUser.slice(0, 500),
    decisions: [],
    done: lastAnswer ? [lastAnswer.slice(0, 500)] : [],
    next: [],
    open_questions: [],
    sections: [],
  };
}

/** A title that doesn't come from the prompts: the agent's goal, else the branch. */
function untitled(goal: string | undefined, branch: string | undefined): string {
  const g = goal?.trim().split("\n")[0];
  if (g) return g.length > 80 ? g.slice(0, 79) + "…" : g;
  return branch ? `Session on ${branch}` : "Shared session";
}

/** Turns a local session into a redacted upload. Nothing here touches the network. */
export function buildShare(local: LocalSession, repo: RepoInfo, opts: BuildOptions): BuiltShare {
  const redact = createRedactor(opts.redactionPatterns);
  const tail = opts.tail ?? DEFAULT_TAIL;
  // Paths in text are made repo-relative so they read the same on every machine.
  const roots = [local.cwd, repo.root].filter(Boolean).sort((a, b) => b.length - a.length);
  const clean = (s: string) => {
    let out = s;
    for (const r of roots) out = out.split(r + "/").join("").split(r).join(".");
    if (out.length > MAX_MESSAGE_CHARS) out = out.slice(0, MAX_MESSAGE_CHARS) + " …[truncated]";
    return redact(out);
  };
  const kept = opts.hidePrompts ? hidePrompts(local.messages) : local.messages;
  const all = kept.map((m) => ({ ...m, text: clean(m.text) }));
  const raw = opts.summary ?? fallbackSummary(kept);
  if (opts.hidePrompts && !opts.summary) raw.goal = "";
  // Most agents title a session with its first prompt.
  const title = opts.title ?? (opts.hidePrompts ? untitled(opts.summary?.goal, local.branch ?? repo.branch) : local.title);
  const summary: Summary = {
    goal: clean(raw.goal),
    decisions: raw.decisions.map(clean),
    done: raw.done.map(clean),
    next: raw.next.map(clean),
    open_questions: raw.open_questions.map(clean),
    sections: (raw.sections ?? []).map((s) => ({ title: clean(s.title).slice(0, 60), items: s.items.map(clean) })),
  };

  const session: SessionUpload = {
    source: { tool: local.tool, version: local.version, native_id: local.nativeId },
    repo: repo.repo,
    branch: repo.branch ?? local.branch,
    commit: repo.commit,
    title: clean(title).slice(0, 200),
    summary,
    files_touched: [...new Set(local.filesTouched.map((f) => relativeTo(repo.root, f)))].sort(),
    messages: opts.include === "summary" ? [] : takeTail(all, tail),
    // Found in the whole conversation, not only the tail.
    links: mergeLinks(opts.links, findLinks(all.map((m) => m.text), repo.repo)),
    include: opts.include,
    visibility: opts.visibility ?? { team: true, people: [] },
    redactions: 0,
    started_at: local.startedAt,
    draft: false,
  };
  session.redactions = redact.total();
  return { session, transcript: opts.include === "full" ? all : undefined, redactions: { ...redact.counts }, hits: redact.hits, promptsHidden: Boolean(opts.hidePrompts) };
}
