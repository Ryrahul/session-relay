import { z } from "zod";
import { IncludeMode, Message, PrUrl, SessionRecord, SessionUpload, SourceTool, Summary, Visibility } from "./session.js";

export const Role = z.enum(["owner", "admin", "member"]);
export type Role = z.infer<typeof Role>;

/** POST /v1/sessions. `transcript` is only sent for include = "full". */
export const ShareRequest = z.object({
  session: SessionUpload,
  transcript: z.array(Message).optional(),
});
export type ShareRequest = z.infer<typeof ShareRequest>;

/** Row in GET /v1/sessions. */
export const SessionListItem = z.object({
  id: z.string(),
  title: z.string(),
  repo: z.string(),
  branch: z.string().nullable(),
  tool: SourceTool,
  author: z.object({ id: z.string(), name: z.string() }),
  goal: z.string(),
  include: IncludeMode,
  message_count: z.number().int(),
  has_full_transcript: z.boolean(),
  visibility_team: z.boolean(),
  /** Set when this share continues another session. */
  continues_id: z.string().nullable(),
  assignee: z.object({ id: z.string(), name: z.string() }).nullable(),
  pr_url: z.string().nullable(),
  comment_count: z.number().int(),
  draft: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});
export type SessionListItem = z.infer<typeof SessionListItem>;

export const DetailMode = z.enum(["summary", "tail", "full"]);
export type DetailMode = z.infer<typeof DetailMode>;

/** A session in a handoff chain. */
export const ChainLink = z.object({
  id: z.string(),
  title: z.string(),
  tool: SourceTool,
  author: z.object({ id: z.string(), name: z.string() }),
  created_at: z.string(),
});
export type ChainLink = z.infer<typeof ChainLink>;

/** A note on a shared session. */
export const Comment = z.object({
  id: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
  body: z.string(),
  created_at: z.string(),
});
export type Comment = z.infer<typeof Comment>;

/** POST /v1/sessions/:id/comments */
export const NewComment = z.object({ body: z.string().trim().min(1).max(4000) });
export type NewComment = z.infer<typeof NewComment>;

/** GET /v1/sessions/:id. `messages` is the requested window. */
export const SessionDetail = SessionRecord.extend({
  people: z.array(z.object({ id: z.string(), name: z.string() })),
  message_total: z.number().int(),
  message_offset: z.number().int(),
  /** Sessions this one continues, oldest first (only those visible to the caller). */
  chain: z.array(ChainLink),
  /** Sessions that continued this one. */
  continued_by: z.array(ChainLink),
  /** The member `assignee` points to. */
  assigned_to: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Oldest first; the most recent 100. */
  comments: z.array(Comment),
  /** Required sections of the repo's template that this share leaves empty. */
  missing_sections: z.array(z.string()),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

/** PATCH /v1/sessions/:id (author or admin). `null` clears assignee or pr_url. */
export const SessionPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  visibility: Visibility.optional(),
  summary: Summary.optional(),
  assignee: z.string().max(40).nullable().optional(),
  pr_url: PrUrl.nullable().optional(),
  /** false publishes a draft (it can't be turned back into one). */
  draft: z.literal(false).optional(),
});
export type SessionPatch = z.infer<typeof SessionPatch>;

/** What a handoff in matching repos should contain. `repo`: exact, "github.com/acme/*", or "*". */
export const ShareTemplate = z.object({
  repo: z.string().trim().min(1).max(300),
  instructions: z.string().max(2000).default(""),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(60),
        hint: z.string().max(300).default(""),
        required: z.boolean().default(false),
      }),
    )
    .max(10)
    .default([]),
});
export type ShareTemplate = z.infer<typeof ShareTemplate>;

export const OrgSettings = z.object({
  retention_days: z.number().int(),
  repo_allowlist: z.array(z.string()),
  redaction_patterns: z.array(z.string()),
  share_templates: z.array(ShareTemplate).default([]),
});
export type OrgSettings = z.infer<typeof OrgSettings>;

export const MeResponse = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  org: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  role: Role,
  settings: OrgSettings,
});
export type MeResponse = z.infer<typeof MeResponse>;

export const Member = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: Role,
  joined_at: z.string(),
});
export type Member = z.infer<typeof Member>;

export const InviteRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: Role.default("member"),
});
export type InviteRequest = z.infer<typeof InviteRequest>;

/** GET /v1/org */
export const OrgInfo = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  settings: OrgSettings,
  stats: z.object({ members: z.number().int(), sessions: z.number().int(), storage_bytes: z.number().int() }),
});
export type OrgInfo = z.infer<typeof OrgInfo>;

/** PATCH /v1/org (admins). Patterns must be valid JavaScript regex sources. */
export const OrgPatch = z.object({
  name: z.string().min(1).max(100).optional(),
  retention_days: z.number().int().min(1).max(3650).optional(),
  repo_allowlist: z.array(z.string().min(1).max(300)).max(200).optional(),
  redaction_patterns: z
    .array(
      z
        .string()
        .min(1)
        .max(500)
        .refine((s) => {
          try {
            new RegExp(s);
            return true;
          } catch {
            return false;
          }
        }, "is not a valid regular expression"),
    )
    .max(50)
    .optional(),
  share_templates: z.array(ShareTemplate).max(50).optional(),
});
export type OrgPatch = z.infer<typeof OrgPatch>;

/** POST /v1/invites (admins) */
export const CreateInvite = z.object({
  role: Role.default("member"),
  expires_days: z.number().int().min(1).max(30).default(7),
  note: z.string().max(100).optional(),
});
export type CreateInvite = z.infer<typeof CreateInvite>;

export const InviteInfo = z.object({
  id: z.string(),
  role: Role,
  note: z.string().nullable(),
  created_by: z.string().nullable(),
  expires_at: z.string(),
  created_at: z.string(),
  status: z.enum(["pending", "used", "expired", "revoked"]),
  used_by: z.string().nullable(),
});
export type InviteInfo = z.infer<typeof InviteInfo>;

/** GET /v1/join/:secret (public) */
export const JoinInfo = z.object({ org: z.string(), role: Role, expires_at: z.string() });
export type JoinInfo = z.infer<typeof JoinInfo>;

export const JoinRequest = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
});
export type JoinRequest = z.infer<typeof JoinRequest>;

/** POST /v1/auth/device (public): the CLI starts a browser login. */
export const DeviceStart = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_url: z.string(),
  interval: z.number().int(),
  expires_in: z.number().int(),
});
export type DeviceStart = z.infer<typeof DeviceStart>;

const Person = z.object({ id: z.string(), name: z.string() });

/** GET /v1/activity?days=N: what happened on sessions the caller can see. */
export const Activity = z.object({
  since: z.string(),
  pickups: z.array(z.object({ session_id: z.string(), session_title: z.string(), session_author: Person, by: Person, at: z.string() })),
  comments: z.array(z.object({ session_id: z.string(), session_title: z.string(), author: Person, body: z.string(), created_at: z.string() })),
});
export type Activity = z.infer<typeof Activity>;

const Count = z.number().int();

/** GET /v1/stats?days=N: org-wide counts. Repos only include sessions the caller can see. */
export const Stats = z.object({
  since: z.string(),
  days: Count,
  totals: z.object({ shares: Count, pickups: Count, continued: Count, comments: Count, active_people: Count }),
  by_day: z.array(z.object({ day: z.string(), shares: Count, pickups: Count })),
  by_tool: z.array(z.object({ tool: SourceTool, shares: Count })),
  by_repo: z.array(z.object({ repo: z.string(), shares: Count })),
  by_person: z.array(z.object({ id: z.string(), name: z.string(), shares: Count, pickups: Count, comments: Count })),
});
export type Stats = z.infer<typeof Stats>;

/** GET /v1/audit (admins) */
export const AuditEntry = z.object({
  id: z.number().int(),
  action: z.string(),
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
  target_id: z.string().nullable(),
  /** Title of the session the entry is about, if it still exists. */
  session_title: z.string().nullable(),
  meta: z.record(z.unknown()),
  created_at: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
