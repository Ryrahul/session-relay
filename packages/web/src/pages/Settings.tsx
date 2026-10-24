import { useEffect, useState, type FormEvent } from "react";
import type { MeResponse, OrgInfo } from "@session-relay/shared";
import { api, download, type TokenInfo } from "../api";
import { ago, bytes } from "../format";
import { Command } from "../ui";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function OrgSettings({ me, onOrgChanged }: { me: MeResponse; onOrgChanged: () => void }) {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [name, setName] = useState("");
  const [retention, setRetention] = useState("90");
  const [allowlist, setAllowlist] = useState("");
  const [patterns, setPatterns] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const isAdmin = me.role !== "member";

  const load = () =>
    api.org().then((o) => {
      setOrg(o);
      setName(o.name);
      setRetention(String(o.settings.retention_days));
      setAllowlist(o.settings.repo_allowlist.join("\n"));
      setPatterns(o.settings.redaction_patterns.join("\n"));
    });
  useEffect(() => {
    void load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.updateOrg({
        name: name.trim(),
        retention_days: Number(retention),
        repo_allowlist: lines(allowlist),
        redaction_patterns: lines(patterns),
      });
      await load();
      onOrgChanged();
      setStatus({ kind: "ok", text: "Saved." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  }

  if (!org) return <section className="card"><div className="skeleton-list" aria-busy="true" /></section>;

  return (
    <section className="card">
      <h2>Organization</h2>
      <div className="stats">
        <div>
          <span className="stat">{org.stats.members}</span>
          <span className="faint small">members</span>
        </div>
        <div>
          <span className="stat">{org.stats.sessions}</span>
          <span className="faint small">shared sessions</span>
        </div>
        <div>
          <span className="stat">{bytes(org.stats.storage_bytes)}</span>
          <span className="faint small">stored</span>
        </div>
      </div>
      <form className="settings-form" onSubmit={save}>
        <fieldset disabled={!isAdmin}>
          <div className="field">
            <label htmlFor="org-name">Name</label>
            <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="org-retention">Keep shares for (days)</label>
            <input id="org-retention" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} />
            <p className="hint">Applies to new shares. Expired shares and their transcripts are deleted automatically.</p>
          </div>
          <div className="field">
            <label htmlFor="org-allowlist">Allowed repositories</label>
            <textarea
              id="org-allowlist"
              rows={3}
              placeholder={"github.com/your-org/*\ngithub.com/your-org/api"}
              value={allowlist}
              onChange={(e) => setAllowlist(e.target.value)}
            />
            <p className="hint">One per line. Leave empty to allow any repository. End with /* to allow a whole owner.</p>
          </div>
          <div className="field">
            <label htmlFor="org-patterns">Extra secret patterns</label>
            <textarea
              id="org-patterns"
              rows={3}
              className="mono"
              placeholder={"ACME-[0-9]{6}\ninternal\\.example\\.com"}
              value={patterns}
              onChange={(e) => setPatterns(e.target.value)}
            />
            <p className="hint">
              Regular expressions, one per line. Matches are removed on each laptop before upload, in addition to the built-in rules.
            </p>
          </div>
          {isAdmin && (
            <div className="row">
              <button type="submit" className="btn-primary">
                Save changes
              </button>
              {status && (
                <span className={status.kind === "ok" ? "ok-text" : "error"} role="status">
                  {status.text}
                </span>
              )}
            </div>
          )}
        </fieldset>
        {!isAdmin && <p className="hint">Only admins can change these settings.</p>}
      </form>
    </section>
  );
}

function Tokens() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => api.tokens().then((r) => setTokens(r.tokens));
  useEffect(() => {
    void load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const t = await api.createToken(name.trim());
      setCreated(t.token);
      setName("");
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeToken(id);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="card">
      <h2>Your tokens</h2>
      <p className="muted small">One per laptop makes it easy to revoke a lost machine without logging out everywhere.</p>
      <form className="inline-form" onSubmit={create}>
        <label htmlFor="token-name" className="sr-only">
          Token name
        </label>
        <input id="token-name" placeholder="e.g. work laptop" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        <button type="submit" className="btn-primary">
          Create token
        </button>
      </form>
      {created && (
        <div className="reveal">
          <p>Copy it now. It won't be shown again.</p>
          <Command>{`relay login --server ${location.origin} --token ${created}`}</Command>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <ul className="token-list">
        {tokens.map((t) => (
          <li key={t.id} className={t.revoked ? "revoked" : ""}>
            <div>
              <span className="token-name">{t.name}</span>
              <span className="faint small">
                created {ago(t.created_at)} · {t.last_used_at ? `last used ${ago(t.last_used_at)}` : "never used"}
              </span>
            </div>
            {t.revoked ? (
              <span className="faint small">Revoked</span>
            ) : (
              <button type="button" className="btn-ghost btn-sm" onClick={() => revoke(t.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Download the sessions you can see, as NDJSON (one session per line). */
function ExportCard() {
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState("");
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.list({ limit: "100" }).then((r) => setRepos([...new Set(r.sessions.map((s) => s.repo))].sort()), () => undefined);
  }, []);
  async function run() {
    setBusy(true);
    setError("");
    try {
      await download(`/v1/sessions/export?${new URLSearchParams({ ...(repo ? { repo } : {}), ...(full ? { full: "1" } : {}) })}`, "sessions.ndjson");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Export</h2>
      <p className="muted small">Download the sessions you can see, one JSON object per line (the newest 1000). Single sessions download from their page.</p>
      <div className="row">
        <select aria-label="Repository to export" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">All repositories</option>
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Full transcripts
        </label>
        <button type="button" className="btn-primary btn-sm" onClick={run} disabled={busy}>
          {busy ? "Preparing…" : "Download"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function Settings({ me, onOrgChanged }: { me: MeResponse; onOrgChanged: () => void }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Signed in as {me.user.email} · {me.role}
          </p>
        </div>
      </header>
      <OrgSettings me={me} onOrgChanged={onOrgChanged} />
      <Tokens />
      <ExportCard />
    </div>
  );
}
