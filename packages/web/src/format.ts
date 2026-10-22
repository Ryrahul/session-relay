export const TOOL_NAMES: Record<string, string> = { "claude-code": "Claude Code", opencode: "OpenCode", codex: "Codex" };

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Hash routes: #/ (list), #/s/<id> (session), #/members. */
export type Route = { page: "list" } | { page: "session"; id: string } | { page: "members" };

export function parseRoute(hash: string): Route {
  const m = /^#\/s\/([\w-]+)/.exec(hash);
  if (m) return { page: "session", id: m[1]! };
  if (hash.startsWith("#/members")) return { page: "members" };
  return { page: "list" };
}
