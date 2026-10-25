import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, Member, MeResponse } from "@session-relay/shared";
import { api } from "../api";
import { dateTime } from "../format";
import { Avatar, Empty } from "../ui";

const ACTIONS = [
  { value: "", label: "Everything" },
  { value: "session.share", label: "Shares" },
  { value: "session.pickup", label: "Pickups" },
  { value: "session.pull", label: "Views" },
  { value: "session.update", label: "Edits" },
  { value: "session.comment", label: "Comments" },
  { value: "session.export", label: "Exports" },
  { value: "session.delete", label: "Deletes" },
  { value: "live", label: "Live" },
  { value: "member", label: "Members" },
  { value: "invite", label: "Invites" },
  { value: "token", label: "Tokens" },
  { value: "org", label: "Settings" },
];

const SETTING_NAMES: Record<string, string> = {
  name: "name",
  retention_days: "retention",
  repo_allowlist: "allowed repositories",
  redaction_patterns: "secret patterns",
  share_templates: "handoff templates",
  live_autonomy: "whether agents may act on live messages without asking",
};
const EDIT_NAMES: Record<string, string> = { title: "title", summary: "summary", assignee: "who it's for", pr_url: "pull request", draft: "draft", visibility: "visibility" };
const list = (keys: string[], names: Record<string, string>) => keys.map((k) => names[k] ?? k.replace(/_/g, " ")).join(", ");

/** Plain words for an audit action. */
function describe(e: AuditEntry, people: Map<string, string>): string {
  const m = e.meta as Record<string, unknown>;
  const who = (id: string | null) => (id && people.get(id)) || "someone";
  switch (e.action) {
    case "session.share":
      return m.published ? "published a draft" : "shared";
    case "session.draft":
      return "saved a draft of";
    case "session.pull":
      return m.mode === "full" ? "opened the full transcript of" : "opened";
    case "session.pickup":
      return "picked up";
    case "session.update":
      return Object.keys(m).length ? `edited the ${list(Object.keys(m), EDIT_NAMES)} of` : "edited";
    case "session.comment":
      return "commented on";
    case "session.comment.delete":
      return "deleted a comment on";
    case "session.export":
      return m.bulk
        ? `exported ${m.count} sessions${m.repo ? ` from ${m.repo}` : ""}${m.full ? " with full transcripts" : ""}`
        : `exported (${m.format === "json" ? "JSON" : "Markdown"})`;
    case "session.delete":
      return "deleted";
    case "member.add":
      return `added ${m.email ?? who(e.target_id)}${m.role ? ` as ${m.role}` : ""}`;
    case "member.remove":
      return `removed ${who(e.target_id)}`;
    case "invite.create":
      return `created an invite link${m.role ? ` (${m.role}, ${m.expires_days} day${m.expires_days === 1 ? "" : "s"})` : ""}`;
    case "invite.revoke":
      return "revoked an invite link";
    case "invite.accept":
      return "joined with an invite link";
    case "token.create":
      return "created a token";
    case "token.revoke":
      return "revoked a token";
    case "token.issue_cli":
      return "was issued a token from the server shell";
    case "org.setup":
      return "set up the organization";
    case "device.approve":
      return `signed in the CLI${m.client ? ` on ${m.client}` : ""}`;
    case "device.deny":
      return "denied a CLI sign-in";
    case "org.update": {
      const keys = Object.keys(m);
      return keys.length ? `changed ${list(keys, SETTING_NAMES)}` : "changed settings";
    }
    case "live.start":
      return `started working live${m.repo ? ` in ${m.repo}` : ""}${m.autonomy ? " (agent acts on messages without asking)" : ""}`;
    case "live.end":
      return "ended a live session";
    case "live.update":
      return m.autonomy ? "let their agent act on teammates' messages without asking" : "made their agent ask before acting on teammates' messages";
    case "live.message":
      return `sent a live ${m.kind === "question" ? "question" : m.kind === "answer" ? "answer" : "message"}${Number(m.to) > 1 ? ` to ${m.to} live sessions` : ""}${m.agent ? " (written by their agent)" : ""}`;
    default:
      return e.action.replace(/[._]/g, " ");
  }
}

/** Admins: who did what in the org. */
export function Audit({ me }: { me: MeResponse }) {
  const [action, setAction] = useState("");
  const [user, setUser] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    (before?: number) =>
      api
        .audit({ action, user, limit: "50", before: before ? String(before) : "" })
        .then((r) => {
          setEntries((cur) => (before && cur ? [...cur, ...r.entries] : r.entries));
          setNext(r.next);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [action, user],
  );

  useEffect(() => {
    setEntries(null);
    load();
  }, [load]);
  useEffect(() => {
    api.members().then((r) => setMembers(r.members), () => undefined);
  }, []);

  const people = new Map(members.map((m) => [m.id, m.name]));

  if (me.role === "member") return <div className="page"><p className="error">Only admins can see the audit log.</p></div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every share, view, pickup, edit, comment, export, live message and settings change in {me.org.name}.</p>
        </div>
      </header>
      <div className="toolbar toolbar-filters">
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select aria-label="Person" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {entries === null && !error && <div className="skeleton-list" aria-busy="true" />}
      {entries?.length === 0 && <Empty title="Nothing recorded">{action || user ? <p className="muted">Try other filters.</p> : null}</Empty>}
      {entries && entries.length > 0 && (
        <section className="card">
          <ul className="audit-list">
            {entries.map((e) => (
              <li key={e.id} className="audit-row">
                <span className="faint small audit-time">{dateTime(e.created_at)}</span>
                <span className="audit-what">
                  {e.user ? (
                    <span className="who">
                      <Avatar name={e.user.name} size={20} /> <strong>{e.user.name}</strong>
                    </span>
                  ) : (
                    <strong>System</strong>
                  )}{" "}
                  {describe(e, people)}{" "}
                  {e.session_title ? (
                    <a href={`#/s/${e.target_id}`}>{e.session_title}</a>
                  ) : (
                    e.action.startsWith("session.") && e.target_id && <span className="faint">a deleted session</span>
                  )}
                  {e.action.startsWith("live.") && e.target_id && <a href={`#/live/${e.target_id}`}>{e.target_id}</a>}
                </span>
              </li>
            ))}
          </ul>
          {next && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => load(next)}>
              Load older
            </button>
          )}
        </section>
      )}
    </div>
  );
}
