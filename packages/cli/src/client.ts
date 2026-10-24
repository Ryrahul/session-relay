import type {
  Comment,
  DetailMode,
  Member,
  MeResponse,
  SessionDetail,
  SessionListItem,
  SessionPatch,
  ShareRequest,
} from "@session-relay/shared";
import { api } from "./api.js";
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
  get(id: string, mode: DetailMode = "tail", opts: { tail?: number; offset?: number; limit?: number } = {}) {
    const params = new URLSearchParams({ mode });
    for (const [k, v] of Object.entries(opts)) if (v !== undefined) params.set(k, String(v));
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
