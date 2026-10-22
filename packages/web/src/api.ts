import type { Member, MeResponse, SessionDetail, SessionListItem } from "@session-relay/shared";

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
  constructor(readonly status: number, message: string) {
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

export const api = {
  me: (token?: string) => call<MeResponse>("GET", "/v1/me", undefined, token),
  list: (params: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return call<{ sessions: SessionListItem[] }>("GET", `/v1/sessions?${q}`);
  },
  get: (id: string, mode: "tail" | "full", offset = 0) =>
    call<SessionDetail>("GET", `/v1/sessions/${encodeURIComponent(id)}?mode=${mode}&offset=${offset}&limit=1000`),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/v1/sessions/${encodeURIComponent(id)}`),
  members: () => call<{ members: Member[] }>("GET", "/v1/members"),
  invite: (email: string, name: string, role: string) =>
    call<{ user: Member; token: string }>("POST", "/v1/members", { email, name, role }),
};
