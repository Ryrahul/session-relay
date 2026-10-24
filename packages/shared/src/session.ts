import { z } from "zod";

/** Agent tools we can read sessions from. */
export const SourceTool = z.enum(["claude-code", "codex", "opencode", "zcode", "gemini", "copilot", "cursor"]);
export type SourceTool = z.infer<typeof SourceTool>;

/** How much of a session a share carries. */
export const IncludeMode = z.enum(["summary", "summary+tail", "full"]);
export type IncludeMode = z.infer<typeof IncludeMode>;

export const MessageRole = z.enum(["user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

/**
 * One normalised message. Tool calls are reduced to a short text outcome
 * ("edited src/a.ts (+42 -8)") so any agent can read them.
 */
export const Message = z.object({
  role: MessageRole,
  text: z.string(),
  at: z.string().datetime().optional(),
});
export type Message = z.infer<typeof Message>;

/** An extra handoff section, usually asked for by the repo's template ("Tests run", "Migration notes"). */
export const SummarySection = z.object({
  title: z.string().trim().min(1).max(60),
  items: z.array(z.string()).default([]),
});
export type SummarySection = z.infer<typeof SummarySection>;

export const Summary = z.object({
  goal: z.string(),
  decisions: z.array(z.string()).default([]),
  done: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  sections: z.array(SummarySection).max(20).default([]),
});
export type Summary = z.infer<typeof Summary>;

export const Visibility = z.object({
  /** Visible to every member of the org. */
  team: z.boolean().default(true),
  /** User ids that can see it when `team` is false. */
  people: z.array(z.string()).default([]),
});
export type Visibility = z.infer<typeof Visibility>;

/** A link to a pull/merge request: any http(s) URL. */
export const PrUrl = z
  .string()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");

/** Payload the CLI uploads. Already redacted and normalised on the client. */
export const SessionUpload = z.object({
  source: z.object({
    tool: SourceTool,
    version: z.string().optional(),
    native_id: z.string(),
  }),
  /** Normalised remote, e.g. "github.com/acme/payments-api". */
  repo: z.string(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  title: z.string().min(1).max(200),
  summary: Summary,
  /** Paths relative to the repo root. */
  files_touched: z.array(z.string()).default([]),
  /** The tail kept in the database (summary+tail and full). */
  messages: z.array(Message).default([]),
  include: IncludeMode,
  visibility: Visibility.default({ team: true, people: [] }),
  redactions: z.number().int().nonnegative().default(0),
  started_at: z.string().datetime().optional(),
  /** Id of the shared session this one continues (after a /pickup). */
  continues: z.string().max(40).optional(),
  /** Member this handoff is for (user id). They see it first in /pickup, even when it's private. */
  assignee: z.string().max(40).optional(),
  /** Pull request the work belongs to. */
  pr_url: PrUrl.optional(),
  /** Saved automatically at session end: only the author sees it until it's published. */
  draft: z.boolean().default(false),
});
export type SessionUpload = z.infer<typeof SessionUpload>;

/** Session as returned by the API. */
export const SessionRecord = SessionUpload.extend({
  id: z.string(),
  org_id: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
  has_full_transcript: z.boolean(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime().nullable(),
  /** Set when the share was edited after it was created. */
  updated_at: z.string().datetime().nullable(),
});
export type SessionRecord = z.infer<typeof SessionRecord>;
