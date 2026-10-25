import type { Activity, AuditEntry, LiveDetail, LivePatch, LiveSession, Stats, InviteInfo, JoinInfo, Member, MeResponse, OrgInfo, OrgPatch, SessionDetail, SessionListItem, SessionPatch } from "@session-relay/shared";

const KEY = "relay.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the session lasts until reload.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, token = getToken()): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token ?? ""}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

/** Fetches a file with the token and saves it through the browser. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(path, { headers: { authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface TokenInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export const api = {
  setupStatus: () => call<{ needed: boolean }>("GET", "/v1/setup", undefined, ""),
  setup: (body: { code: string; org: string; name: string; email: string }) =>
    call<{ token: string; org: { id: string; name: string; slug: string } }>("POST", "/v1/setup", body, ""),
  me: (token?: string) => call<MeResponse>("GET", "/v1/me", undefined, token),
  list: (params: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return call<{ sessions: SessionListItem[] }>("GET", `/v1/sessions?${q}`);
  },
  get: (id: string, mode: "tail" | "full", offset = 0) =>
    call<SessionDetail>("GET", `/v1/sessions/${encodeURIComponent(id)}?mode=${mode}&offset=${offset}&limit=1000`),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/v1/sessions/${encodeURIComponent(id)}`),
  comment: (id: string, body: string) => call<{ id: string }>("POST", `/v1/sessions/${encodeURIComponent(id)}/comments`, { body }),
  deleteComment: (id: string, commentId: string) =>
    call<{ ok: true }>("DELETE", `/v1/sessions/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`),
  diff: async (id: string) => {
    const res = await fetch(`/v1/sessions/${encodeURIComponent(id)}/diff`, { headers: { authorization: `Bearer ${getToken() ?? ""}` } });
    if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
    return res.text();
  },
  update: (id: string, patch: SessionPatch) => call<{ ok: true }>("PATCH", `/v1/sessions/${encodeURIComponent(id)}`, patch),
  liveList: () => call<{ live: LiveSession[] }>("GET", "/v1/live"),
  liveGet: (id: string) => call<LiveDetail>("GET", `/v1/live/${encodeURIComponent(id)}`),
  liveUpdate: (id: string, patch: LivePatch) => call<{ ok: true }>("PATCH", `/v1/live/${encodeURIComponent(id)}`, patch),
  liveEnd: (id: string) => call<{ ok: true }>("POST", `/v1/live/${encodeURIComponent(id)}/end`, {}),
  liveRead: (id: string) => call<{ ok: true }>("POST", `/v1/live/${encodeURIComponent(id)}/read`, {}),
  liveSend: (body: { from_live?: string; to_live?: string; to_user?: string; body: string; kind: string; reply_to?: number }) =>
    call<{ ids: number[]; people: string[] }>("POST", "/v1/live/messages", body),
  members: () => call<{ members: Member[] }>("GET", "/v1/members"),
  audit: (params: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return call<{ entries: AuditEntry[]; next: number | null }>("GET", `/v1/audit?${q}`);
  },
  activity: (days: number) => call<Activity>("GET", `/v1/activity?days=${days}`),
  stats: (days: number) => call<Stats>("GET", `/v1/stats?days=${days}`),
  invite: (email: string, name: string, role: string) =>
    call<{ user: Member; token: string }>("POST", "/v1/members", { email, name, role }),
  removeMember: (userId: string) => call<{ ok: true }>("DELETE", `/v1/members/${encodeURIComponent(userId)}`),
  org: () => call<OrgInfo>("GET", "/v1/org"),
  updateOrg: (patch: OrgPatch) => call<{ ok: true }>("PATCH", "/v1/org", patch),
  tokens: () => call<{ tokens: TokenInfo[] }>("GET", "/v1/tokens"),
  createToken: (name: string) => call<{ id: string; name: string; token: string }>("POST", "/v1/tokens", { name }),
  revokeToken: (id: string) => call<{ ok: true }>("DELETE", `/v1/tokens/${encodeURIComponent(id)}`),
  invites: () => call<{ invites: InviteInfo[] }>("GET", "/v1/invites"),
  createInvite: (role: string, expires_days: number) =>
    call<{ id: string; url: string; role: string; expires_at: string }>("POST", "/v1/invites", { role, expires_days }),
  revokeInvite: (id: string) => call<{ ok: true }>("DELETE", `/v1/invites/${encodeURIComponent(id)}`),
  joinInfo: (secret: string) => call<JoinInfo>("GET", `/v1/join/${encodeURIComponent(secret)}`, undefined, ""),
  join: (secret: string, name: string, email: string) =>
    call<{ token: string; role: string }>("POST", `/v1/join/${encodeURIComponent(secret)}`, { name, email }, ""),
  deviceInfo: (code: string) => call<{ client_name: string; expires_at: string }>("GET", `/v1/auth/device/${encodeURIComponent(code)}`),
  deviceDecide: (code: string, approve: boolean) =>
    call<{ ok: true; client_name: string }>("POST", `/v1/auth/device/${approve ? "approve" : "deny"}`, { user_code: code }),
};
