import { useEffect, useMemo, useState } from "react";
import type { SessionListItem } from "@session-relay/shared";
import { api } from "./api";
import { ago, TOOL_NAMES } from "./format";

export function SessionList() {
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState("");
  const [tool, setTool] = useState("");
  const [rows, setRows] = useState<SessionListItem[] | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.list({ limit: "100" }).then((r) => setRepos([...new Set(r.sessions.map((s) => s.repo))].sort()), () => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .list({ q, repo, tool, limit: "100" })
        .then((r) => {
          setRows(r.sessions);
          setError("");
        })
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, repo, tool]);

  const empty = useMemo(() => rows !== null && rows.length === 0, [rows]);

  return (
    <section>
      <div className="filters">
        <input id="search" type="search" placeholder="Search titles, summaries, messages…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="repo" value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
          <option value="">All repos</option>
          {repos.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select id="tool" value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Tool">
          <option value="">All tools</option>
          {Object.entries(TOOL_NAMES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && <p className="muted">Loading…</p>}
      {empty && (
        <div className="empty">
          <p>No shared sessions{q || repo || tool ? " match these filters" : " yet"}.</p>
          <p className="muted">
            Share one from your agent with <code>/share</code>, or from a terminal with <code>relay share</code>.
          </p>
        </div>
      )}
      <ul className="rows">
        {rows?.map((s) => (
          <li key={s.id}>
            <a href={`#/s/${s.id}`} className="row">
              <div className="row-main">
                <span className="title">{s.title}</span>
                <span className="goal">{s.goal}</span>
              </div>
              <div className="row-meta">
                <span className={`tool t-${s.tool}`}>{TOOL_NAMES[s.tool]}</span>
                <span>{s.author.name}</span>
                <span className="mono">{s.repo.split("/").slice(-1)[0]}{s.branch ? `@${s.branch}` : ""}</span>
                <span>{ago(s.created_at)}</span>
                {!s.visibility_team && <span className="pill">private</span>}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
