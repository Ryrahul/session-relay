import { useEffect, useState } from "react";
import type { Activity as ActivityData, MeResponse, SessionListItem } from "@session-relay/shared";
import { api } from "../api";
import { ago, shortRepo } from "../format";
import { RichText } from "../text";
import { Avatar, Empty, Icon, ToolBadge } from "../ui";

const PERIODS = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

function Row({ s, me }: { s: SessionListItem; me: MeResponse }) {
  return (
    <li>
      <a href={`#/s/${s.id}`} className="activity-row">
        <ToolBadge tool={s.tool} />
        <span className="activity-title">{s.title}</span>
        {s.assignee && (
          <span className={`badge ${s.assignee.id === me.user.id ? "badge-accent" : ""}`}>
            <Icon name="user" size={12} /> {s.assignee.id === me.user.id ? "For you" : `For ${s.assignee.name}`}
          </span>
        )}
        {s.comment_count > 0 && (
          <span className="faint small">
            <Icon name="comment" size={12} /> {s.comment_count}
          </span>
        )}
        <span className="faint small push">
          {s.author.name} · {ago(s.created_at)}
        </span>
      </a>
    </li>
  );
}

/** The team digest: what was shared, what's for you, who picked up what, and new comments. */
export function Activity({ me }: { me: MeResponse }) {
  const [days, setDays] = useState(1);
  const [shared, setShared] = useState<SessionListItem[] | null>(null);
  const [forMe, setForMe] = useState<SessionListItem[]>([]);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setShared(null);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    Promise.all([api.list({ since, limit: "100" }), api.list({ assignee: "me", limit: "20" }), api.activity(days)])
      .then(([s, f, a]) => {
        setShared(s.sessions);
        setForMe(f.sessions);
        setActivity(a);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [days]);

  const byRepo = new Map<string, SessionListItem[]>();
  for (const s of shared ?? []) byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s]);
  const repos = [...byRepo].sort((a, b) => b[1].length - a[1].length);
  const quiet = shared?.length === 0 && !activity?.pickups.length && !activity?.comments.length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted">What {me.org.name} shared, picked up and discussed.</p>
        </div>
      </header>
      <div className="chips" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" className={`chip ${days === p.days ? "on" : ""}`} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {shared === null && !error && <div className="skeleton-list" aria-busy="true" />}

      {shared && activity && (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="tile-value">{shared.length}</span>
              <span className="tile-label">shared</span>
            </div>
            <div className="tile">
              <span className="tile-value">{activity.pickups.length}</span>
              <span className="tile-label">picked up</span>
            </div>
            <div className="tile">
              <span className="tile-value">{activity.comments.length}</span>
              <span className="tile-label">comments</span>
            </div>
            <div className="tile">
              <span className="tile-value">{forMe.length}</span>
              <span className="tile-label">for you</span>
            </div>
          </div>

          {forMe.length > 0 && (
            <section className="card">
              <h2>
                <Icon name="user" size={14} /> For you
              </h2>
              <ul className="activity-list">
                {forMe.map((s) => (
                  <Row key={s.id} s={s} me={me} />
                ))}
              </ul>
            </section>
          )}

          {quiet && (
            <Empty title="Quiet period">
              <p className="muted">Nothing was shared, picked up or commented on. Try a longer period.</p>
            </Empty>
          )}

          {repos.map(([repo, list]) => (
            <section key={repo} className="card">
              <h2 className="mono" title={repo}>
                {shortRepo(repo)} <span className="muted small">{list.length} shared</span>
              </h2>
              <ul className="activity-list">
                {list.map((s) => (
                  <Row key={s.id} s={s} me={me} />
                ))}
              </ul>
            </section>
          ))}

          {activity.pickups.length > 0 && (
            <section className="card">
              <h2>Picked up</h2>
              <ul className="activity-list">
                {activity.pickups.map((p) => (
                  <li key={p.by.id + p.session_id} className="activity-event">
                    <Avatar name={p.by.name} size={22} />
                    <span>
                      <strong>{p.by.name}</strong> picked up <a href={`#/s/${p.session_id}`}>{p.session_title}</a>
                      <span className="faint"> by {p.session_author.name}</span>
                    </span>
                    <span className="faint small push">{ago(p.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activity.comments.length > 0 && (
            <section className="card">
              <h2>Comments</h2>
              <ul className="activity-list">
                {activity.comments.map((c, i) => (
                  <li key={i} className="activity-event activity-comment">
                    <Avatar name={c.author.name} size={22} />
                    <div>
                      <div>
                        <strong>{c.author.name}</strong> on <a href={`#/s/${c.session_id}`}>{c.session_title}</a>
                        <span className="faint small"> · {ago(c.created_at)}</span>
                      </div>
                      <RichText text={c.body} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
