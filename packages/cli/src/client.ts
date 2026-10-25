import type {
  Activity,
  AuditEntry,
  Comment,
  LiveDetail,
  LivePatch,
  LivePollResult,
  LiveSession,
  LiveStart,
  Stats,
  DetailMode,
  Member,
  MeResponse,
  SessionDetail,
  SessionListItem,
  SessionPatch,
  ShareTemplate,
  ShareRequest,
} from "@session-relay/shared";
import { api, apiText } from "./api.js";
import { resolveConfig, type CliConfig } from "./config.js";
import { createRedactor } from "@session-relay/shared";

export interface ListQuery {
  repo?: string;
  branch?: string;
  tool?: string;
  author?: string;
  /** "me" or a user id. */
  assignee?: string;
  /** Part of a touched file's path. */
  file?: string;
  /** ISO time: only sessions shared since then. */
  since?: string;
  native_id?: string;
  /** Drafts are left out unless "include" or "only". */
  drafts?: "include" | "only";
  q?: string;
  limit?: number;
}

/** Typed wrapper around the relay API. */
export class RelayClient {
  constructor(readonly config: CliConfig) {}

  static async fromConfig(): Promise<RelayClient> {
    const config = await resolveConfig();
    if (!config) throw new Error("Not logged in. Run: relay login --server <url> --token <token>");
    return new RelayClient(config);
  }

  me() {
    return api<MeResponse>(this.config, "GET", "v1/me");
  }
  share(body: ShareRequest) {
    return api<{ id: string }>(this.config, "POST", "v1/sessions", body);
  }
  list(query: ListQuery = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
    return api<{ sessions: SessionListItem[] }>(this.config, "GET", `v1/sessions?${params}`);
  }
  /** `pickup` marks it as picked up to continue (counted in stats and activity), not just viewed. */
  get(id: string, mode: DetailMode = "tail", opts: { tail?: number; offset?: number; limit?: number; pickup?: boolean } = {}) {
    const params = new URLSearchParams({ mode });
    for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== false) params.set(k, v === true ? "1" : String(v));
    return api<SessionDetail>(this.config, "GET", `v1/sessions/${encodeURIComponent(id)}?${params}`);
  }
  update(id: string, patch: SessionPatch) {
    return api<{ ok: true }>(this.config, "PATCH", `v1/sessions/${encodeURIComponent(id)}`, patch);
  }
  comments(id: string) {
    return api<{ comments: Comment[] }>(this.config, "GET", `v1/sessions/${encodeURIComponent(id)}/comments`);
  }
  /** Secrets are removed from the note before it leaves the machine, like shares. */
  comment(id: string, body: string) {
    return api<{ id: string }>(this.config, "POST", `v1/sessions/${encodeURIComponent(id)}/comments`, { body: createRedactor()(body) });
  }
  remove(id: string) {
    return api<{ ok: true }>(this.config, "DELETE", `v1/sessions/${encodeURIComponent(id)}`);
  }
  template(repo: string) {
    return api<{ template: ShareTemplate | null }>(this.config, "GET", `v1/org/template?repo=${encodeURIComponent(repo)}`);
  }
  activity(days = 1) {
    return api<Activity>(this.config, "GET", `v1/activity?days=${days}`);
  }
  stats(days = 30) {
    return api<Stats>(this.config, "GET", `v1/stats?days=${days}`);
  }
  diff(id: string) {
    return apiText(this.config, `v1/sessions/${encodeURIComponent(id)}/diff`);
  }
  export(id: string, format: "md" | "json") {
    return apiText(this.config, `v1/sessions/${encodeURIComponent(id)}/export?format=${format}`);
  }
  exportAll(query: { repo?: string; since?: string; author?: string; full?: boolean }) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v === true ? "1" : String(v));
    return apiText(this.config, `v1/sessions/export?${params}`);
  }
  audit(query: { action?: string; user?: string; target?: string; before?: number; limit?: number }) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
    return api<{ entries: AuditEntry[]; next: number | null }>(this.config, "GET", `v1/audit?${params}`);
  }
  liveList(withEnded = false) {
    return api<{ live: LiveSession[] }>(this.config, "GET", `v1/live${withEnded ? "?ended=1" : ""}`);
  }
  liveStart(body: Partial<LiveStart> & { repo: string }) {
    return api<{ id: string }>(this.config, "POST", "v1/live", body);
  }
  liveGet(id: string) {
    return api<LiveDetail>(this.config, "GET", `v1/live/${encodeURIComponent(id)}`);
  }
  liveUpdate(id: string, patch: LivePatch) {
    return api<{ ok: true }>(this.config, "PATCH", `v1/live/${encodeURIComponent(id)}`, patch);
  }
  liveEnd(id: string) {
    return api<{ ok: true }>(this.config, "POST", `v1/live/${encodeURIComponent(id)}/end`, {});
  }
  livePoll(id: string, body: { files?: string[]; status?: string; ack?: boolean } = {}, timeoutMs?: number) {
    return api<LivePollResult>(this.config, "POST", `v1/live/${encodeURIComponent(id)}/poll`, body, timeoutMs);
  }
  /** Secrets are removed before the message leaves the machine, like shares. */
  liveSend(body: { from_live?: string; to_live?: string; to_user?: string; to_repo?: string; body: string; kind?: string; reply_to?: number; from_agent?: boolean }) {
    return api<{ ids: number[]; delivered_to: number; people: string[]; skipped: string[] }>(this.config, "POST", "v1/live/messages", {
      ...body,
      body: createRedactor()(body.body),
    });
  }
  members() {
    return api<{ members: Member[] }>(this.config, "GET", "v1/members");
  }
  inviteLink(role: string, expiresDays: number) {
    return api<{ id: string; url: string; role: string; expires_at: string }>(this.config, "POST", "v1/invites", { role, expires_days: expiresDays });
  }
  invite(email: string, name: string, role: string) {
    return api<{ user: Member; token: string }>(this.config, "POST", "v1/members", { email, name, role });
  }
}

/** One member id from a name, email or id. */
export async function resolvePerson(client: RelayClient, name: string): Promise<string> {
  return (await resolvePeople(client, [name]))[0]!;
}

/** Resolves "alice", "alice@x.dev" or a user id to member ids. */
export async function resolvePeople(client: RelayClient, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { members } = await client.members();
  return names.map((n) => {
    const needle = n.trim().toLowerCase();
    const hits = members.filter(
      (m) => m.id === n || m.email.toLowerCase() === needle || m.name.toLowerCase() === needle || m.name.toLowerCase().startsWith(needle),
    );
    if (hits.length !== 1) {
      throw new Error(hits.length ? `"${n}" matches several people: ${hits.map((h) => h.name).join(", ")}` : `No member called "${n}"`);
    }
    return hits[0]!.id;
  });
}
