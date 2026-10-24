import { useEffect, useMemo, useState } from "react";
import type { MeResponse, SessionListItem } from "@session-relay/shared";
import { api } from "../api";
import { ago, dayLabel, prLabel, shortRepo, TOOL_NAMES } from "../format";
import { Avatar, Empty, Icon, ToolBadge } from "../ui";

const TOOLS = Object.keys(TOOL_NAMES);

export function Sessions({ me }: { me: MeResponse }) {
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState("");
  const [tool, setTool] = useState("");
  const [mine, setMine] = useState(false);
  const [forMe, setForMe] = useState(false);
  const [drafts, setDrafts] = useState(false);
  const [rows, setRows] = useState<SessionListItem[] | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.list({ limit: "100" }).then(
      (r) => setRepos([...new Set(r.sessions.map((s) => s.repo))].sort()),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .list({ q, repo, tool, author: mine || drafts ? "me" : "", assignee: forMe ? "me" : "", drafts: drafts ? "only" : "", limit: "100" })
        .then((r) => {
          setRows(r.sessions);
          setError("");
        })
        .catch((e) => setError(e.message));
    }, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, repo, tool, mine, forMe, drafts]);

  // Search results stay in rank order; otherwise group by day.
  const groups = useMemo(() => {
    if (!rows) return [];
    if (q) return [{ label: `${rows.length} result${rows.length === 1 ? "" : "s"}`, rows }];
    const out: { label: string; rows: SessionListItem[] }[] = [];
    for (const r of rows) {
      const label = dayLabel(r.created_at);
      if (out.at(-1)?.label === label) out.at(-1)!.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [rows, q]);

  const filtered = Boolean(q || repo || tool || mine || forMe || drafts);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="muted">What your team has shared from their coding agents.</p>
        </div>
      </header>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            id="search"
            type="search"
            placeholder="Search, or file:src/app.ts branch:main"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search sessions"
          />
        </label>
        <select id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository">
          <option value="">All repositories</option>
          {repos.map((r) => (
            <option key={r} value={r}>
              {shortRepo(r)}
            </option>
          ))}
        </select>
      </div>
      <div className="chips" role="group" aria-label="Filters">
        <button type="button" className={`chip ${!tool ? "on" : ""}`} aria-pressed={!tool} onClick={() => setTool("")}>
          All tools
        </button>
        {TOOLS.map((t) => (
          <button key={t} type="button" className={`chip chip-${t} ${tool === t ? "on" : ""}`} aria-pressed={tool === t} onClick={() => setTool(tool === t ? "" : t)}>
            {TOOL_NAMES[t]}
          </button>
        ))}
        <span className="chip-sep" />
        <button type="button" className={`chip ${forMe ? "on" : ""}`} aria-pressed={forMe} onClick={() => setForMe(!forMe)}>
          For me
        </button>
        <button type="button" className={`chip ${mine ? "on" : ""}`} aria-pressed={mine} onClick={() => setMine(!mine)}>
          Shared by me
        </button>
        <button type="button" className={`chip ${drafts ? "on" : ""}`} aria-pressed={drafts} onClick={() => setDrafts(!drafts)}>
          My drafts
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {rows === null && !error && <div className="skeleton-list" aria-busy="true" />}

      {rows?.length === 0 &&
        (filtered ? (
          <Empty title="No sessions match">
            <p className="muted">Try a different search, or clear the filters.</p>
          </Empty>
        ) : (
          <Empty title="Nothing shared yet">
            <p className="muted">
              In Claude Code, OpenCode, Codex or ZCode, run <code>/share</code> at the end of a session. It will show up here for{" "}
              {me.org.name}.
            </p>
            <a className="btn-primary" href="#/start">
              Connect your agents
            </a>
          </Empty>
        ))}

      {groups.map((g) => (
        <section key={g.label} className="group">
          <h2 className="group-label">{g.label}</h2>
          <ul className="session-list">
            {g.rows.map((s) => (
              <li key={s.id}>
                <a href={`#/s/${s.id}`} className="session-row">
                  <div className="row-top">
                    <span className="row-title">{s.title}</span>
                    <span className="row-badges">
                      {s.draft && (
                        <span className="badge badge-draft" title="Saved automatically at session end. Only you can see it until you publish it.">
                          Draft
                        </span>
                      )}
                      {s.assignee && (
                        <span className={`badge ${s.assignee.id === me.user.id ? "badge-accent" : ""}`} title={`Handoff for ${s.assignee.name}`}>
                          <Icon name="user" size={12} /> {s.assignee.id === me.user.id ? "For you" : `For ${s.assignee.name}`}
                        </span>
                      )}
                      {s.pr_url && (
                        <span className="badge" title={s.pr_url}>
                          <Icon name="pr" size={12} /> {prLabel(s.pr_url)}
                        </span>
                      )}
                      {s.continues_id && (
                        <span className="badge" title="Continues an earlier shared session">
                          <Icon name="chain" size={12} /> Continues
                        </span>
                      )}
                      {!s.visibility_team && (
                        <span className="badge" title="Only visible to selected people">
                          <Icon name="lock" size={12} /> Private
                        </span>
                      )}
                    </span>
                  </div>
                  {s.goal && s.goal !== s.title && <p className="row-goal">{s.goal}</p>}
                  <div className="row-meta">
                    <ToolBadge tool={s.tool} />
                    <span className="who">
                      <Avatar name={s.author.name} size={18} />
                      {s.author.name}
                    </span>
                    <span className="mono">
                      {shortRepo(s.repo)}
                      {s.branch && <span className="faint"> · {s.branch}</span>}
                    </span>
                    <span className="faint">{s.message_count ? `${s.message_count} message${s.message_count === 1 ? "" : "s"}` : "summary only"}</span>
                    {s.comment_count > 0 && (
                      <span className="faint" title={`${s.comment_count} comment${s.comment_count === 1 ? "" : "s"}`}>
                        <Icon name="comment" size={12} /> {s.comment_count}
                      </span>
                    )}
                    <span className="faint push">{ago(s.created_at)}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
