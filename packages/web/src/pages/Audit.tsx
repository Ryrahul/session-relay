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
  { value: "member", label: "Members" },
  { value: "invite", label: "Invites" },
  { value: "token", label: "Tokens" },
  { value: "org", label: "Settings" },
];

/** Plain words for an audit action. */
function describe(e: AuditEntry): string {
  const m = e.meta as Record<string, unknown>;
  switch (e.action) {
    case "session.share":
      return m.published ? "published a draft" : "shared";
    case "session.draft":
      return "saved a draft of";
    case "session.pull":
      return `opened (${m.mode ?? "tail"})`;
    case "session.pickup":
      return "picked up";
    case "session.update":
      return `edited (${Object.keys(m).join(", ") || "details"})`;
    case "session.comment":
      return "commented on";
    case "session.comment.delete":
      return "deleted a comment on";
    case "session.export":
      return m.bulk ? `exported ${m.count} sessions${m.repo ? ` from ${m.repo}` : ""}${m.full ? " with full transcripts" : ""}` : `exported (${m.format})`;
    case "session.delete":
      return "deleted";
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

  if (me.role === "member") return <div className="page"><p className="error">Only admins can see the audit log.</p></div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every share, view, pickup, edit, comment, export and settings change in {me.org.name}.</p>
        </div>
      </header>
      <div className="toolbar">
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
                  {describe(e)}{" "}
                  {e.session_title ? <a href={`#/s/${e.target_id}`}>{e.session_title}</a> : e.target_id && <span className="mono faint">{e.target_id}</span>}
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
