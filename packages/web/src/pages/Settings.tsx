import { useEffect, useState, type FormEvent } from "react";
import type { MeResponse, OrgInfo, ShareTemplate } from "@session-relay/shared";
import { api, download, type TokenInfo } from "../api";
import { ago, bytes } from "../format";
import { Command, Icon } from "../ui";

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

const blankTemplate = (): ShareTemplate => ({ repo: "*", instructions: "", sections: [{ title: "", hint: "", required: true }] });

/** Admins: what a handoff should contain, per repo pattern. */
function Templates({ me, onSaved }: { me: MeResponse; onSaved: () => void }) {
  const isAdmin = me.role !== "member";
  const [list, setList] = useState<ShareTemplate[]>(() => structuredClone(me.settings.share_templates ?? []));
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const update = (i: number, t: ShareTemplate) => setList(list.map((x, n) => (n === i ? t : x)));

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const cleaned = list.map((t) => ({ ...t, repo: t.repo.trim(), sections: t.sections.filter((x) => x.title.trim()) })).filter((t) => t.repo);
      await api.updateOrg({ share_templates: cleaned });
      setList(cleaned);
      setStatus({ kind: "ok", text: "Saved." });
      onSaved();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Handoff templates</h2>
      <p className="muted small">
        Extra sections a share should have in matching repos, like "Tests run" or "Migration notes". <code>/share</code> asks the agent to fill them in;
        required ones that are empty are flagged on the session. Repo: an exact repo (<code>github.com/acme/api</code>), a prefix (
        <code>github.com/acme/*</code>), or <code>*</code> for all. The most specific match wins.
      </p>
      {list.length === 0 && <p className="faint small">No templates yet.</p>}
      <fieldset disabled={!isAdmin} className="templates">
        {list.map((t, i) => (
          <div key={i} className="template-card">
            <div className="row">
              <div className="field grow">
                <label htmlFor={`tpl-repo-${i}`}>Repositories</label>
                <input id={`tpl-repo-${i}`} value={t.repo} onChange={(e) => update(i, { ...t, repo: e.target.value })} placeholder="github.com/acme/*" />
              </div>
              <button type="button" className="icon-btn" aria-label={`Remove template ${i + 1}`} onClick={() => setList(list.filter((_, n) => n !== i))}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div className="field">
              <label htmlFor={`tpl-ins-${i}`}>Instructions for the agent (optional)</label>
              <textarea id={`tpl-ins-${i}`} rows={2} value={t.instructions} maxLength={2000} onChange={(e) => update(i, { ...t, instructions: e.target.value })} placeholder="Mention feature flags you touched." />
            </div>
            <div className="template-sections">
              {t.sections.map((sec, j) => (
                <div key={j} className="template-section-row">
                  <input aria-label={`Section ${j + 1} title`} placeholder="Tests run" value={sec.title} maxLength={60}
                    onChange={(e) => update(i, { ...t, sections: t.sections.map((x, n) => (n === j ? { ...x, title: e.target.value } : x)) })} />
                  <input aria-label={`Section ${j + 1} hint`} placeholder="Hint for the agent (optional)" value={sec.hint} maxLength={300}
                    onChange={(e) => update(i, { ...t, sections: t.sections.map((x, n) => (n === j ? { ...x, hint: e.target.value } : x)) })} />
                  <label className="check">
                    <input type="checkbox" checked={sec.required}
                      onChange={(e) => update(i, { ...t, sections: t.sections.map((x, n) => (n === j ? { ...x, required: e.target.checked } : x)) })} /> Required
                  </label>
                  <button type="button" className="icon-btn" aria-label={`Remove section ${j + 1}`} onClick={() => update(i, { ...t, sections: t.sections.filter((_, n) => n !== j) })}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
              {t.sections.length < 10 && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => update(i, { ...t, sections: [...t.sections, { title: "", hint: "", required: false }] })}>
                  <Icon name="plus" size={14} /> Section
                </button>
              )}
            </div>
          </div>
        ))}
      </fieldset>
      {isAdmin ? (
        <div className="row">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setList([...list, blankTemplate()])}>
            <Icon name="plus" size={14} /> Template
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save templates"}
          </button>
          {status && <span className={status.kind === "ok" ? "ok-text" : "error"} role="status">{status.text}</span>}
        </div>
      ) : (
        <p className="hint">Only admins can change templates.</p>
      )}
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
      <Templates me={me} onSaved={onOrgChanged} />
      <Tokens />
      <ExportCard />
    </div>
  );
}
