import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createRedactor, describeTemplate, matchTemplate, type MeResponse, type OrgInfo, type ShareTemplate } from "@session-relay/shared";
import { api, download, type TokenInfo } from "../api";
import { ago, bytes, shortRepo } from "../format";
import { Command, Icon } from "../ui";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

type Status = { kind: "ok" | "error"; text: string } | null;

function SaveStatus({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <span className={status.kind === "ok" ? "ok-text" : "error"} role="status">
      {status.kind === "ok" && <Icon name="check" size={14} />} {status.text}
    </span>
  );
}

/** The repositories that have shared sessions, for pickers and template matching. */
function useKnownRepos() {
  const [repos, setRepos] = useState<string[]>([]);
  useEffect(() => {
    api.list({ limit: "100" }).then((r) => setRepos([...new Set(r.sessions.map((s) => s.repo))].sort()), () => undefined);
  }, []);
  return repos;
}

function useOrg() {
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const load = () => api.org().then(setOrg);
  useEffect(() => {
    void load();
  }, []);
  return { org, reload: load };
}

function General({ me, onOrgChanged }: { me: MeResponse; onOrgChanged: () => void }) {
  const { org, reload } = useOrg();
  const [name, setName] = useState("");
  const [retention, setRetention] = useState("90");
  const [liveAuto, setLiveAuto] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const isAdmin = me.role !== "member";
  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setRetention(String(org.settings.retention_days));
    setLiveAuto(org.settings.live_autonomy);
  }, [org]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.updateOrg({ name: name.trim(), retention_days: Number(retention), live_autonomy: liveAuto });
      await reload();
      onOrgChanged();
      setStatus({ kind: "ok", text: "Saved" });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  }

  if (!org) return <section className="card"><div className="skeleton-list" aria-busy="true" /></section>;
  const dirty = name !== org.name || retention !== String(org.settings.retention_days) || liveAuto !== org.settings.live_autonomy;

  return (
    <>
      <div className="stat-tiles">
        <div className="card stat-tile">
          <span className="stat">{org.stats.members}</span>
          <span className="faint small">members</span>
        </div>
        <div className="card stat-tile">
          <span className="stat">{org.stats.sessions}</span>
          <span className="faint small">shared sessions</span>
        </div>
        <div className="card stat-tile">
          <span className="stat">{bytes(org.stats.storage_bytes)}</span>
          <span className="faint small">stored</span>
        </div>
      </div>
      <section className="card">
        <h2>Organization</h2>
        <form className="settings-form" onSubmit={save}>
          <fieldset disabled={!isAdmin}>
            <div className="field">
              <label htmlFor="org-name">Name</label>
              <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="org-retention">Keep shares for</label>
              <div className="input-suffix">
                <input id="org-retention" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} />
                <span>days</span>
              </div>
              <p className="hint">Applies to new shares. Expired shares and their transcripts are deleted automatically.</p>
            </div>
            <div className="field">
              <span className="label">Live sessions</span>
              <label className="live-autonomy">
                <span className="switch">
                  <input type="checkbox" checked={liveAuto} onChange={(e) => setLiveAuto(e.target.checked)} />
                  <span />
                </span>
                <span>
                  <strong>People may let their agent act on teammates' messages without asking</strong>
                  <span className="hint">
                    Each person chooses for their own live session; it's off until they turn it on. Turning this off switches it off for everyone, including live sessions already running.
                  </span>
                </span>
              </label>
            </div>
            {isAdmin && (
              <div className="row">
                <button type="submit" className="btn-primary" disabled={!dirty}>
                  Save changes
                </button>
                <SaveStatus status={status} />
              </div>
            )}
          </fieldset>
          {!isAdmin && <p className="hint">Only admins can change these settings.</p>}
        </form>
      </section>
    </>
  );
}

function Privacy({ me }: { me: MeResponse }) {
  const { org, reload } = useOrg();
  const [allowlist, setAllowlist] = useState("");
  const [patterns, setPatterns] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const isAdmin = me.role !== "member";
  useEffect(() => {
    if (!org) return;
    setAllowlist(org.settings.repo_allowlist.join("\n"));
    setPatterns(org.settings.redaction_patterns.join("\n"));
  }, [org]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.updateOrg({ repo_allowlist: lines(allowlist), redaction_patterns: lines(patterns) });
      await reload();
      setStatus({ kind: "ok", text: "Saved" });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  }

  if (!org) return <section className="card"><div className="skeleton-list" aria-busy="true" /></section>;
  const dirty = lines(allowlist).join("\n") !== org.settings.repo_allowlist.join("\n") || lines(patterns).join("\n") !== org.settings.redaction_patterns.join("\n");

  return (
    <form className="settings-form panel" onSubmit={save}>
      <fieldset disabled={!isAdmin} className="panel">
        <section className="card">
          <h2>Allowed repositories</h2>
          <p className="muted small">Limit which repositories can be shared. Leave empty to allow any.</p>
          <textarea
            id="org-allowlist"
            aria-label="Allowed repositories"
            rows={3}
            className="mono"
            placeholder={"github.com/your-org/*\ngithub.com/your-org/api"}
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
          />
          <p className="hint">One per line. End with <code>/*</code> to allow everything from one owner.</p>
        </section>
        <section className="card">
          <h2>Secret redaction</h2>
          <p className="muted small">
            API keys, tokens, passwords, private keys and connection strings are always removed on each laptop before upload. Add your own patterns for anything
            else, like internal hostnames or ticket ids.
          </p>
          <label htmlFor="org-patterns">Extra patterns (regular expressions, one per line)</label>
          <textarea
            id="org-patterns"
            rows={3}
            className="mono"
            placeholder={"ACME-[0-9]{6}\ninternal\\.example\\.com"}
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
          />
          <RedactionPreview patterns={lines(patterns)} />
        </section>
      </fieldset>
      {isAdmin ? (
        <div className="row">
          <button type="submit" className="btn-primary" disabled={!dirty}>
            Save changes
          </button>
          <SaveStatus status={status} />
        </div>
      ) : (
        <p className="hint">Only admins can change these settings.</p>
      )}
    </form>
  );
}

const SAMPLE = `Deployed with AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY to staging.
curl -H "Authorization: Bearer abcdefghijklmnop1234567890" https://api.example.com
Ticket ACME-123456 is fixed; db at postgres://app:hunter2secret@db.internal:5432/app`;

/** Try the built-in rules plus the (unsaved) org patterns on sample text, right in the browser. */
function RedactionPreview({ patterns }: { patterns: string[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(SAMPLE);
  const result = useMemo(() => {
    const bad = patterns.filter((p) => {
      try {
        new RegExp(p);
        return false;
      } catch {
        return true;
      }
    });
    const r = createRedactor(patterns);
    return { out: r(text), counts: r.counts, total: r.total(), bad };
  }, [patterns, text]);
  return (
    <>
      {result.bad.length > 0 && <p className="error small">Not a valid pattern: {result.bad.join(", ")}</p>}
      {!open ? (
        <button type="button" className="btn-ghost btn-sm self-start" onClick={() => setOpen(true)}>
          <Icon name="search" size={14} /> Test on sample text
        </button>
      ) : (
        <div className="redaction-preview">
          <div className="preview-cols">
            <div className="field">
              <label htmlFor="redaction-sample">Paste something to test</label>
              <textarea id="redaction-sample" rows={5} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="field">
              <span className="label">What would be uploaded</span>
              <pre className="redaction-out" aria-label="What would be uploaded">
                {result.out.split(/(\[REDACTED:[a-z-]+\])/).map((part, i) =>
                  part.startsWith("[REDACTED:") ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
                )}
              </pre>
            </div>
          </div>
          <p className="small" role="status">
            {result.total
              ? `${result.total} removed: ${Object.entries(result.counts).map(([k, n]) => `${n} ${k}`).join(", ")}`
              : "Nothing would be removed."}
          </p>
        </div>
      )}
    </>
  );
}

/** Ready-made sections admins can add with one click. */
const SUGGESTED = [
  { title: "Tests run", hint: "Commands run and their results", required: true },
  { title: "Rollout notes", hint: "Feature flags, migrations, order of deploys", required: false },
  { title: "Migration notes", hint: "Schema or data changes and how to run them", required: false },
  { title: "Risks", hint: "What could break and how to check", required: false },
  { title: "How to verify", hint: "Steps a reviewer can follow to see it working", required: false },
  { title: "Follow-up tickets", hint: "Links to issues created for remaining work", required: false },
];

const exampleTemplate = (repo: string): ShareTemplate => ({
  repo,
  instructions: "",
  sections: [SUGGESTED[0]!, SUGGESTED[1]!],
});

const clean = (list: ShareTemplate[]) =>
  list
    .map((t) => ({ ...t, repo: t.repo.trim(), instructions: t.instructions.trim(), sections: t.sections.map((s) => ({ ...s, title: s.title.trim() })).filter((s) => s.title) }))
    .filter((t) => t.repo);

function problems(list: ShareTemplate[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  list.forEach((t, i) => {
    const label = t.repo.trim() || `Template ${i + 1}`;
    if (!t.repo.trim()) out.push(`Template ${i + 1} needs repositories (use * for all).`);
    else if (seen.has(t.repo.trim().toLowerCase())) out.push(`Two templates use ${t.repo.trim()}; merge them into one.`);
    seen.add(t.repo.trim().toLowerCase());
    const titles = t.sections.map((s) => s.title.trim().toLowerCase()).filter(Boolean);
    if (new Set(titles).size !== titles.length) out.push(`${label} has the same section twice.`);
    if (t.sections.some((s) => !s.title.trim() && s.hint.trim())) out.push(`${label} has a section with a hint but no name.`);
  });
  return out;
}

/** Admins: what a handoff should contain, per repo pattern. */
function Templates({ me, onSaved }: { me: MeResponse; onSaved: () => void }) {
  const isAdmin = me.role !== "member";
  const repos = useKnownRepos();
  const [saved, setSaved] = useState<ShareTemplate[]>(() => structuredClone(me.settings.share_templates ?? []));
  const [list, setList] = useState<ShareTemplate[]>(() => structuredClone(me.settings.share_templates ?? []));
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);
  const update = (i: number, t: ShareTemplate) => {
    setStatus(null);
    setList(list.map((x, n) => (n === i ? t : x)));
  };
  const dirty = JSON.stringify(clean(list)) !== JSON.stringify(clean(saved)) || list.length !== saved.length;
  const issues = problems(list);
  const owners = [...new Set(repos.map((r) => r.split("/").slice(0, -1).join("/") + "/*"))];

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  function add(t: ShareTemplate) {
    setStatus(null);
    setList([...list, t]);
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const cleaned = clean(list);
      await api.updateOrg({ share_templates: cleaned });
      setList(structuredClone(cleaned));
      setSaved(structuredClone(cleaned));
      setStatus({ kind: "ok", text: "Saved. /share uses it from now on." });
      onSaved();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) return <TemplatesReadOnly list={saved} />;

  const suggestRepo = owners[0] ?? "*";

  return (
    <div className="panel">
      <section className="card how-it-works">
        <h2>Handoff templates</h2>
        <p className="muted small">Make every handoff in a repo answer the same questions, like which tests were run or how to roll it out.</p>
        <ol className="steps-inline">
          <li>
            <strong>Pick repositories.</strong> One repo, everything from an owner (<code>github.com/acme/*</code>), or <code>*</code> for all.
          </li>
          <li>
            <strong>Add sections.</strong> Mark the ones that must be filled in as required.
          </li>
          <li>
            <strong>That's it.</strong> <code>/share</code> asks the agent to fill them in. Empty required sections are flagged on the session, with a button to add
            them.
          </li>
        </ol>
      </section>

      {list.length === 0 && (
        <section className="card empty-card">
          <h3>No templates yet</h3>
          <p className="muted small">Start with "Tests run" (required) and "Rollout notes", then change them to fit your team.</p>
          <div className="row center">
            <button type="button" className="btn-primary" onClick={() => add(exampleTemplate(suggestRepo))}>
              <Icon name="plus" size={14} /> Start from an example
            </button>
            <button type="button" className="btn-ghost" onClick={() => add({ repo: suggestRepo, instructions: "", sections: [{ title: "", hint: "", required: true }] })}>
              Blank template
            </button>
          </div>
        </section>
      )}

      {list.map((t, i) => (
        <TemplateCard
          key={i}
          index={i}
          t={t}
          all={list}
          repos={repos}
          owners={owners}
          onChange={(x) => update(i, x)}
          onRemove={() => {
            setStatus(null);
            setList(list.filter((_, n) => n !== i));
          }}
        />
      ))}

      {list.length > 0 && list.length < 50 && (
        <button type="button" className="btn-ghost add-template" onClick={() => add({ repo: "", instructions: "", sections: [{ title: "", hint: "", required: true }] })}>
          <Icon name="plus" size={14} /> Add a template for other repositories
        </button>
      )}

      {(dirty || status) && (
        <div className={`save-bar ${dirty ? "dirty" : ""}`} role="region" aria-label="Save templates">
          {issues.length > 0 ? (
            <span className="error small">{issues[0]}</span>
          ) : (
            <span className="small">{dirty ? "You have unsaved changes." : <SaveStatus status={status} />}</span>
          )}
          {dirty && (
            <span className="row">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setList(structuredClone(saved));
                  setStatus(null);
                }}
              >
                Discard
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving || issues.length > 0}>
                {saving ? "Saving…" : "Save templates"}
              </button>
            </span>
          )}
          {!dirty && status?.kind === "error" && <SaveStatus status={status} />}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  index,
  t,
  all,
  repos,
  owners,
  onChange,
  onRemove,
}: {
  index: number;
  t: ShareTemplate;
  all: ShareTemplate[];
  repos: string[];
  owners: string[];
  onChange: (t: ShareTemplate) => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const setSection = (j: number, patch: Partial<ShareTemplate["sections"][number]>) =>
    onChange({ ...t, sections: t.sections.map((x, n) => (n === j ? { ...x, ...patch } : x)) });
  const move = (j: number, by: number) => {
    const s = [...t.sections];
    [s[j], s[j + by]] = [s[j + by]!, s[j]!];
    onChange({ ...t, sections: s });
  };
  const titles = new Set(t.sections.map((s) => s.title.trim().toLowerCase()));
  const suggestions = SUGGESTED.filter((s) => !titles.has(s.title.toLowerCase()));
  // Repos this template is the one used for (a more specific template wins).
  const used = t.repo.trim() ? repos.filter((r) => matchTemplate(clean(all), r)?.repo === t.repo.trim()) : [];

  return (
    <section className="card template-card" aria-label={`Template for ${t.repo || "new repositories"}`}>
      <div className="template-head">
        <div className="field grow">
          <label htmlFor={`tpl-repo-${index}`}>Applies to</label>
          <input id={`tpl-repo-${index}`} className="mono" value={t.repo} onChange={(e) => onChange({ ...t, repo: e.target.value })} placeholder="github.com/acme/*" maxLength={300} />
          <div className="repo-presets">
            {["*", ...owners].filter((p) => p !== t.repo).slice(0, 4).map((p) => (
              <button key={p} type="button" className="chip chip-sm" onClick={() => onChange({ ...t, repo: p })}>
                {p === "*" ? "All repositories" : p}
              </button>
            ))}
          </div>
          <p className="hint">
            {!t.repo.trim()
              ? "An exact repo, a prefix ending in *, or * for every repo."
              : used.length
                ? `Used for ${used.map(shortRepo).slice(0, 4).join(", ")}${used.length > 4 ? ` and ${used.length - 4} more` : ""}.`
                : repos.length
                  ? "No shared sessions from matching repos yet (or a more specific template covers them)."
                  : "Applies as soon as someone shares from a matching repo."}
          </p>
        </div>
        {confirm ? (
          <span className="row">
            <button type="button" className="btn-danger btn-sm" onClick={onRemove}>
              Remove
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="btn-ghost btn-sm" aria-label={`Remove template ${index + 1}`} onClick={() => setConfirm(true)}>
            <Icon name="trash" size={14} /> Remove
          </button>
        )}
      </div>

      <div className="field">
        <span className="label">Sections</span>
        {t.sections.length > 0 && (
          <div className="section-table" role="table" aria-label="Sections">
            <div className="section-row section-row-head" role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">What to write (shown to the agent)</span>
              <span role="columnheader">Required</span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {t.sections.map((sec, j) => (
              <div key={j} className="section-row" role="row">
                <input
                  aria-label={`Section ${j + 1} title`}
                  placeholder="e.g. Tests run"
                  value={sec.title}
                  maxLength={60}
                  onChange={(e) => setSection(j, { title: e.target.value })}
                />
                <input
                  aria-label={`Section ${j + 1} hint`}
                  placeholder="Optional hint"
                  value={sec.hint}
                  maxLength={300}
                  onChange={(e) => setSection(j, { hint: e.target.value })}
                />
                <label className="switch" title={sec.required ? "Required: flagged when empty" : "Optional"}>
                  <input type="checkbox" checked={sec.required} onChange={(e) => setSection(j, { required: e.target.checked })} aria-label={`Section ${j + 1} required`} />
                  <span aria-hidden="true" />
                </label>
                <span className="section-actions">
                  <button type="button" className="icon-btn" aria-label={`Move section ${j + 1} up`} disabled={j === 0} onClick={() => move(j, -1)}>
                    <Icon name="up" size={14} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move section ${j + 1} down`} disabled={j === t.sections.length - 1} onClick={() => move(j, 1)}>
                    <Icon name="down" size={14} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove section ${j + 1}`} onClick={() => onChange({ ...t, sections: t.sections.filter((_, n) => n !== j) })}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {t.sections.length < 10 ? (
          <div className="row">
            <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ ...t, sections: [...t.sections, { title: "", hint: "", required: false }] })}>
              <Icon name="plus" size={14} /> Section
            </button>
            {suggestions.length > 0 && <span className="faint small">or add</span>}
            {suggestions.slice(0, 4).map((s) => (
              <button key={s.title} type="button" className="chip chip-sm" onClick={() => onChange({ ...t, sections: [...t.sections, { ...s }] })}>
                + {s.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="hint">10 sections at most.</p>
        )}
      </div>

      <div className="field">
        <label htmlFor={`tpl-ins-${index}`}>Extra instructions for the agent (optional)</label>
        <textarea
          id={`tpl-ins-${index}`}
          rows={2}
          value={t.instructions}
          maxLength={2000}
          onChange={(e) => onChange({ ...t, instructions: e.target.value })}
          placeholder="e.g. Mention any feature flags you touched. Link the Linear ticket."
        />
      </div>

      <details className="template-preview">
        <summary>Preview what the agent is told</summary>
        <pre>{describeTemplate(clean([t])[0] ?? { repo: t.repo || "*", instructions: "", sections: [] })}</pre>
      </details>
    </section>
  );
}

function TemplatesReadOnly({ list }: { list: ShareTemplate[] }) {
  return (
    <div className="panel">
      <section className="card">
        <h2>Handoff templates</h2>
        <p className="muted small">
          Sections your admins want in every handoff for these repos. <code>/share</code> fills them in for you; run <code>relay template</code> in a repo to see
          its template.
        </p>
        {list.length === 0 && <p className="faint small">No templates. Handoffs use the standard sections.</p>}
      </section>
      {list.map((t) => (
        <section key={t.repo} className="card">
          <h2 className="mono">{t.repo === "*" ? "All repositories" : t.repo}</h2>
          <ul className="template-ro">
            {t.sections.map((s) => (
              <li key={s.title}>
                <strong>{s.title}</strong> {s.required ? <span className="badge badge-accent">Required</span> : <span className="badge">Optional</span>}
                {s.hint && <span className="faint small"> {s.hint}</span>}
              </li>
            ))}
          </ul>
          {t.instructions && <p className="muted small">{t.instructions}</p>}
        </section>
      ))}
    </div>
  );
}

function Tokens() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

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
      setConfirming(null);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const active = tokens.filter((t) => !t.revoked);
  const revoked = tokens.filter((t) => t.revoked);

  return (
    <section className="card">
      <h2>Your tokens</h2>
      <p className="muted small">
        The CLI uses a token to sign in. <code>relay login</code> creates one for you in the browser; make one here for a machine without a browser, a script or CI.
        One per machine makes it easy to cut off a lost laptop.
      </p>
      <form className="inline-form" onSubmit={create}>
        <label htmlFor="token-name" className="sr-only">
          Token name
        </label>
        <input id="token-name" placeholder="Name it, e.g. work laptop" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        <button type="submit" className="btn-primary">
          Create token
        </button>
      </form>
      {created && (
        <div className="reveal">
          <p>Run this on the machine. The token isn't shown again.</p>
          <Command>{`relay login --server ${location.origin} --token ${created}`}</Command>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <ul className="token-list">
        {active.map((t) => (
          <li key={t.id}>
            <div>
              <span className="token-name">{t.name}</span>
              <span className="faint small">
                created {ago(t.created_at)} · {t.last_used_at ? `last used ${ago(t.last_used_at)}` : "never used"}
              </span>
            </div>
            {confirming === t.id ? (
              <span className="row">
                <button type="button" className="btn-danger btn-sm" onClick={() => revoke(t.id)}>
                  Revoke
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(t.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {revoked.length > 0 && (
        <details className="revoked-tokens">
          <summary className="faint small">{revoked.length} revoked</summary>
          <ul className="token-list">
            {revoked.map((t) => (
              <li key={t.id} className="revoked">
                <div>
                  <span className="token-name">{t.name}</span>
                  <span className="faint small">created {ago(t.created_at)}</span>
                </div>
                <span className="faint small">Revoked</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Download the sessions you can see, as NDJSON (one session per line). */
function ExportCard() {
  const repos = useKnownRepos();
  const [repo, setRepo] = useState("");
  const [full, setFull] = useState(false);
  const [noPrompts, setNoPrompts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      await download(`/v1/sessions/export?${new URLSearchParams({ ...(repo ? { repo } : {}), ...(full ? { full: "1" } : {}), ...(noPrompts ? { prompts: "0" } : {}) })}`, "sessions.ndjson");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Export</h2>
      <p className="muted small">
        Download the sessions you can see (the newest 1000) as NDJSON: one JSON object per line. To download one session as Markdown or JSON, use <strong>Download</strong>{" "}
        on its page.
      </p>
      <div className="export-form">
        <div className="field">
          <label htmlFor="export-repo">Repository</label>
          <select id="export-repo" value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="">All repositories</option>
            {repos.map((r) => (
              <option key={r} value={r}>
                {shortRepo(r)}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Include full transcripts
        </label>
        <label className="check">
          <input type="checkbox" checked={noPrompts} onChange={(e) => setNoPrompts(e.target.checked)} /> Without the authors' prompts
        </label>
        <button type="button" className="btn-primary" onClick={run} disabled={busy}>
          <Icon name="download" size={14} /> {busy ? "Preparing…" : "Download"}
        </button>
      </div>
      <p className="hint">
        From a terminal: <code>relay export --all</code>, or <code>relay export &lt;id&gt;</code> for one session.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

const TABS: { id: string; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "privacy", label: "Privacy", icon: "lock" },
  { id: "templates", label: "Handoff templates", icon: "file" },
  { id: "tokens", label: "Tokens", icon: "key" },
  { id: "export", label: "Export", icon: "download" },
];

export function Settings({ me, tab = "general", onOrgChanged }: { me: MeResponse; tab?: string; onOrgChanged: () => void }) {
  const current = TABS.some((t) => t.id === tab) ? tab : "general";
  const panels: Record<string, ReactNode> = {
    general: <General me={me} onOrgChanged={onOrgChanged} />,
    privacy: <Privacy me={me} />,
    templates: <Templates me={me} onSaved={onOrgChanged} />,
    tokens: <Tokens />,
    export: <ExportCard />,
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Signed in as {me.user.email} · {me.role}
            {me.role === "member" && ". Organization settings are read-only for members."}
          </p>
        </div>
      </header>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <a key={t.id} href={`#/settings/${t.id}`} className={current === t.id ? "on" : ""} aria-current={current === t.id ? "page" : undefined}>
            <Icon name={t.icon} size={14} /> {t.label}
          </a>
        ))}
      </nav>
      {panels[current]}
    </div>
  );
}
