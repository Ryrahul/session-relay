import { z } from "zod";
import { IncludeMode, Message, SessionRecord, SessionUpload, SourceTool, Visibility } from "./session.js";

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
  created_at: z.string(),
});
export type SessionListItem = z.infer<typeof SessionListItem>;

export const DetailMode = z.enum(["summary", "tail", "full"]);
export type DetailMode = z.infer<typeof DetailMode>;

/** GET /v1/sessions/:id. `messages` is the requested window. */
export const SessionDetail = SessionRecord.extend({
  people: z.array(z.object({ id: z.string(), name: z.string() })),
  message_total: z.number().int(),
  message_offset: z.number().int(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

export const SessionPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  visibility: Visibility.optional(),
});
export type SessionPatch = z.infer<typeof SessionPatch>;

export const OrgSettings = z.object({
  retention_days: z.number().int(),
  repo_allowlist: z.array(z.string()),
  redaction_patterns: z.array(z.string()),
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
