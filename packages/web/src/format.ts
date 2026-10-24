export const TOOL_NAMES: Record<string, string> = { "claude-code": "Claude Code", opencode: "OpenCode", codex: "Codex", zcode: "ZCode", gemini: "Gemini CLI", copilot: "Copilot CLI", cursor: "Cursor" };

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "Today", "Yesterday", or a date, for grouping lists. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function shortRepo(repo: string): string {
  return repo.split("/").slice(-2).join("/");
}

/** Hash routes. */
export type Route =
  | { page: "join"; secret: string }
  | { page: "device"; code: string }
  | { page: "sessions" }
  | { page: "activity" }
  | { page: "stats" }
  | { page: "audit" }
  | { page: "session"; id: string }
  | { page: "start" }
  | { page: "members" }
  | { page: "settings" };

export function parseRoute(hash: string): Route {
  const join = /^#\/join\/([\w-]+)/.exec(hash);
  if (join) return { page: "join", secret: join[1]! };
  const device = /^#\/device\/([\w-]+)/.exec(hash);
  if (device) return { page: "device", code: device[1]! };
  const m = /^#\/s\/([\w-]+)/.exec(hash);
  if (m) return { page: "session", id: m[1]! };
  if (hash.startsWith("#/start")) return { page: "start" };
  if (hash.startsWith("#/activity")) return { page: "activity" };
  if (hash.startsWith("#/stats")) return { page: "stats" };
  if (hash.startsWith("#/audit")) return { page: "audit" };
  if (hash.startsWith("#/members")) return { page: "members" };
  if (hash.startsWith("#/settings")) return { page: "settings" };
  return { page: "sessions" };
}

/** "github.com/acme/api/pull/42" → "acme/api#42"; other URLs → their host and path. */
export function prLabel(url: string): string {
  const m = /^https?:\/\/[^/]+\/(.+?)\/(?:pull|merge_requests|pull-requests)\/(\d+)/.exec(url);
  if (m) return `${m[1]!.split("/").slice(-2).join("/")}#${m[2]}`;
  return url.replace(/^https?:\/\//, "");
}
