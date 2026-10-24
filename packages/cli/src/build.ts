import path from "node:path";
import type { IncludeMode, Message, SessionUpload, Summary, Visibility, RedactionHit } from "@session-relay/shared";
import type { LocalSession } from "./adapters/types.js";
import type { RepoInfo } from "./git.js";
import { createRedactor } from "@session-relay/shared";

export const DEFAULT_TAIL = 30;
const MAX_MESSAGE_CHARS = 8000;

export interface BuildOptions {
  include: IncludeMode;
  tail?: number;
  summary?: Summary;
  title?: string;
  visibility?: Visibility;
  redactionPatterns?: string[];
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
  const all = local.messages.map((m) => ({ ...m, text: clean(m.text) }));
  const raw = opts.summary ?? fallbackSummary(local.messages);
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
    title: clean(opts.title ?? local.title).slice(0, 200),
    summary,
    files_touched: [...new Set(local.filesTouched.map((f) => relativeTo(repo.root, f)))].sort(),
    messages: opts.include === "summary" ? [] : all.slice(-tail),
    include: opts.include,
    visibility: opts.visibility ?? { team: true, people: [] },
    redactions: 0,
    started_at: local.startedAt,
    draft: false,
  };
  session.redactions = redact.total();
  return { session, transcript: opts.include === "full" ? all : undefined, redactions: { ...redact.counts }, hits: redact.hits };
}
