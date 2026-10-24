import { useEffect, useMemo, useState } from "react";
import type { ChainLink, Member, MeResponse, Message, SessionDetail } from "@session-relay/shared";
import { api } from "../api";
import { ago, dateTime, prLabel, shortRepo, TOOL_NAMES } from "../format";
import { RichText } from "../text";
import { Avatar, Command, Icon, ToolBadge } from "../ui";

function Section({ title, items, tone }: { title: string; items: string[]; tone?: "next" }) {
  if (!items.length) return null;
  return (
    <section className={`card summary-card ${tone === "next" ? "card-next" : ""}`}>
      <h2>{title}</h2>
      <ul>
        {items.map((i, n) => (
          <li key={n}>
            <RichText text={i} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChainCard({ s }: { s: SessionDetail }) {
  if (!s.chain.length && !s.continued_by.length) return null;
  const Item = ({ l }: { l: ChainLink }) => (
    <li className="chain-item">
      <a href={`#/s/${l.id}`}>{l.title}</a>
      <span className="chain-meta">
        <ToolBadge tool={l.tool} /> {l.author.name} · {ago(l.created_at)}
      </span>
    </li>
  );
  return (
    <section className="card">
      <h2>
        <Icon name="chain" size={14} /> Handoff chain
      </h2>
      <ol className="chain">
        {s.chain.length > 0 && <li className="chain-label">Continues</li>}
        {s.chain.map((l) => (
          <Item key={l.id} l={l} />
        ))}
        <li className="chain-item chain-current">
          <span>{s.title}</span>
          <span className="chain-meta">
            <ToolBadge tool={s.source.tool} /> {s.author.name} · this session
          </span>
        </li>
        {s.continued_by.length > 0 && <li className="chain-label">Continued by</li>}
        {s.continued_by.map((l) => (
          <Item key={l.id} l={l} />
        ))}
      </ol>
    </section>
  );
}

/** One text box per item, so items that span several lines (code, output) stay whole. */
function ItemsField({ id, label, items, onChange }: { id: string; label: string; items: string[]; onChange: (v: string[]) => void }) {
  const set = (i: number, v: string) => onChange(items.map((x, n) => (n === i ? v : x)));
  return (
    <fieldset className="field items-field">
      <legend>{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="item-row">
          <textarea
            id={i === 0 ? id : undefined}
            aria-label={`${label} ${i + 1}`}
            rows={Math.min(8, item.split("\n").length)}
            value={item}
            onChange={(e) => set(i, e.target.value)}
          />
          <button type="button" className="icon-btn" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, n) => n !== i))}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost btn-sm add-item" onClick={() => onChange([...items, ""])}>
        <Icon name="plus" size={14} /> Add
      </button>
    </fieldset>
  );
}

const clean = (items: string[]) => items.map((i) => i.trim()).filter(Boolean);

/** Edit a share in place: title, summary, who it's for and the PR. Author or admin. */
function EditPanel({ s, onSaved, onCancel }: { s: SessionDetail; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(s.title);
  const [goal, setGoal] = useState(s.summary.goal);
  const [next, setNext] = useState(s.summary.next);
  const [decisions, setDecisions] = useState(s.summary.decisions);
  const [done, setDone] = useState(s.summary.done);
  const [questions, setQuestions] = useState(s.summary.open_questions);
  const [assignee, setAssignee] = useState(s.assigned_to?.id ?? "");
  const [pr, setPr] = useState(s.pr_url ?? "");
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.members().then((r) => setMembers(r.members), () => undefined);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.update(s.id, {
        title: title.trim() || s.title,
        summary: { goal: goal.trim(), next: clean(next), decisions: clean(decisions), done: clean(done), open_questions: clean(questions) },
        assignee: assignee || null,
        pr_url: pr.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }


  return (
    <form className="card edit-panel" onSubmit={save} aria-label="Edit share">
      <h2>
        <Icon name="edit" size={14} /> Edit share
      </h2>
      <div className="field">
        <label htmlFor="edit-title">Title</label>
        <input id="edit-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="edit-goal">Goal</label>
        <textarea id="edit-goal" rows={Math.min(8, Math.max(2, goal.split("\n").length))} value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>
      <ItemsField id="edit-next" label="Next steps" items={next} onChange={setNext} />
      <ItemsField id="edit-decisions" label="Decisions" items={decisions} onChange={setDecisions} />
      <ItemsField id="edit-done" label="Done" items={done} onChange={setDone} />
      <ItemsField id="edit-questions" label="Open questions" items={questions} onChange={setQuestions} />
      <div className="edit-row">
        <div className="field">
          <label htmlFor="edit-assignee">For</label>
          <select id="edit-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Anyone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="edit-pr">Pull request</label>
          <input id="edit-pr" type="url" placeholder="https://github.com/acme/api/pull/42" value={pr} onChange={(e) => setPr(e.target.value)} />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Comments({ s, me, onChange }: { s: SessionDetail; me: MeResponse; onChange: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.comment(s.id, body.trim());
      setBody("");
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(commentId: string) {
    try {
      await api.deleteComment(s.id, commentId);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h2 id="comments-title">
        Comments <span className="muted">{s.comments.length || ""}</span>
      </h2>
      {s.comments.length === 0 && <p className="muted small">No comments yet. Agents that pick this session up read them too.</p>}
      <ol className="comment-list">
        {s.comments.map((c) => (
          <li key={c.id} className="comment">
            <Avatar name={c.author.name} size={26} />
            <div className="comment-body">
              <div className="comment-head">
                <strong>{c.author.name}</strong>
                <span className="faint">{ago(c.created_at)}</span>
                {(c.author.id === me.user.id || me.role !== "member") && (
                  <button type="button" className="icon-btn push" aria-label={`Delete comment by ${c.author.name}`} onClick={() => remove(c.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
              <RichText text={c.body} />
            </div>
          </li>
        ))}
      </ol>
      <form className="comment-form" onSubmit={post}>
        <label htmlFor="comment-body" className="sr-only">
          Add a comment
        </label>
        <textarea
          id="comment-body"
          rows={2}
          maxLength={4000}
          placeholder="Leave a note for the team: a question, a finding, &quot;picked this up&quot;"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(e);
          }}
        />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="submit" className="btn-primary btn-sm" disabled={busy || !body.trim()}>
            {busy ? "Posting…" : "Comment"}
          </button>
          <span className="faint small">Don't paste secrets here.</span>
        </div>
      </form>
    </section>
  );
}

type Block = { kind: "msg"; m: Message } | { kind: "tools"; items: Message[] };

/** Consecutive tool lines are folded into one expandable block. */
function toBlocks(messages: Message[]): Block[] {
  const out: Block[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (m.role === "tool" && last?.kind === "tools") last.items.push(m);
    else if (m.role === "tool") out.push({ kind: "tools", items: [m] });
    else out.push({ kind: "msg", m });
  }
  return out;
}

function ToolBlock({ items }: { items: Message[] }) {
  const [open, setOpen] = useState(items.length <= 3);
  const failed = items.filter((i) => i.text.includes("(failed")).length;
  return (
    <div className="tools">
      <button type="button" className="tools-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`chev ${open ? "open" : ""}`}>
          <Icon name="chevron" size={12} />
        </span>
        {items.length} tool call{items.length === 1 ? "" : "s"}
        {failed > 0 && <span className="tools-failed">{failed} failed</span>}
      </button>
      {open && (
        <ul>
          {items.map((t, i) => (
            <li key={i} className={t.text.includes("(failed") ? "failed" : ""}>
              {t.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SessionPage({ id, me }: { id: string; me: MeResponse }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [loadingFull, setLoadingFull] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (version === 0) setS(null);
    setError("");
    api.get(id, "tail").then(setS, (e) => setError(e.status === 404 ? "This session doesn't exist, was deleted, or isn't shared with you." : e.message));
  }, [id, version]);

  const blocks = useMemo(() => (s ? toBlocks(s.messages) : []), [s]);

  async function loadFull() {
    if (!s) return;
    setLoadingFull(true);
    try {
      let page = await api.get(id, "full", 0);
      const messages = [...page.messages];
      while (messages.length < page.message_total) {
        page = await api.get(id, "full", messages.length);
        if (!page.messages.length) break;
        messages.push(...page.messages);
      }
      setS({ ...page, messages, message_offset: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingFull(false);
    }
  }

  async function remove() {
    try {
      await api.remove(id);
      location.hash = "#/";
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error)
    return (
      <div className="page">
        <a href="#/" className="back">
          ← Sessions
        </a>
        <p className="error">{error}</p>
      </div>
    );
  if (!s) return <div className="page"><div className="skeleton-list" aria-busy="true" /></div>;

  const canDelete = s.author.id === me.user.id || me.role !== "member";
  const canEdit = canDelete;
  const showingAll = s.message_offset === 0 && s.messages.length === s.message_total;

  return (
    <div className="page page-wide">
      <a href="#/" className="back">
        ← Sessions
      </a>
      <header className="session-head">
        <div className="session-meta-top">
          <ToolBadge tool={s.source.tool} />
          {!s.visibility.team && (
            <span className="badge">
              <Icon name="lock" size={12} /> Private
            </span>
          )}
          {s.assigned_to && (
            <span className={`badge ${s.assigned_to.id === me.user.id ? "badge-accent" : ""}`}>
              <Icon name="user" size={12} /> {s.assigned_to.id === me.user.id ? "For you" : `For ${s.assigned_to.name}`}
            </span>
          )}
          {s.pr_url && (
            <a className="badge badge-link" href={s.pr_url} target="_blank" rel="noreferrer">
              <Icon name="pr" size={12} /> {prLabel(s.pr_url)}
            </a>
          )}
          {canEdit && !editing && (
            <button type="button" className="btn-ghost btn-sm push" onClick={() => setEditing(true)}>
              <Icon name="edit" size={14} /> Edit
            </button>
          )}
        </div>
        <h1>{s.title}</h1>
        <p className="session-byline">
          <Avatar name={s.author.name} size={22} />
          <span>
            <strong>{s.author.name}</strong> shared from {TOOL_NAMES[s.source.tool]} · {ago(s.created_at)}
            {s.updated_at && <span className="faint"> · edited {ago(s.updated_at)}</span>}
            {s.chain.length > 0 && (
              <>
                {" · continues "}
                <a href={`#/s/${s.chain[s.chain.length - 1]!.id}`}>{s.chain[s.chain.length - 1]!.author.name}'s session</a>
              </>
            )}
          </span>
        </p>
      </header>

      <div className="session-grid">
        <div className="session-main">
          {editing && (
            <EditPanel
              s={s}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setVersion((v) => v + 1);
              }}
            />
          )}
          <section className="card summary-card card-goal">
            <h2>Goal</h2>
            <RichText text={s.summary.goal || "Not stated."} />
          </section>
          <Section title="Next steps" items={s.summary.next} tone="next" />
          <Section title="Decisions" items={s.summary.decisions} />
          <Section title="Done" items={s.summary.done} />
          <Section title="Open questions" items={s.summary.open_questions} />

          <section className="conversation">
            <div className="conversation-head">
              <h2>Conversation</h2>
              <span className="muted">
                {s.message_total === 0
                  ? "Shared as summary only"
                  : showingAll
                    ? `All ${s.message_total} messages`
                    : `Last ${s.messages.length} of ${s.message_total} messages`}
              </span>
              {s.has_full_transcript && !showingAll && (
                <button type="button" className="btn-ghost btn-sm" onClick={loadFull} disabled={loadingFull}>
                  {loadingFull ? "Loading…" : "Load full transcript"}
                </button>
              )}
            </div>
            <ol className="timeline">
              {blocks.map((b, i) =>
                b.kind === "tools" ? (
                  <li key={i} className="tl tl-tools">
                    <ToolBlock items={b.items} />
                  </li>
                ) : (
                  <li key={i} className={`tl tl-${b.m.role}`}>
                    <div className="tl-who">{b.m.role === "user" ? s.author.name : TOOL_NAMES[s.source.tool]}</div>
                    <RichText text={b.m.text} />
                  </li>
                ),
              )}
            </ol>
          </section>
          <Comments s={s} me={me} onChange={() => setVersion((v) => v + 1)} />
        </div>

        <aside className="session-side">
          <ChainCard s={s} />
          <section className="card">
            <h2>Continue this session</h2>
            <p className="muted small">In your agent:</p>
            <Command>{`/pickup ${s.id}`}</Command>
            <p className="muted small">Or write a handoff file from the terminal:</p>
            <Command>{`relay pull ${s.id}`}</Command>
          </section>

          <section className="card">
            <h2>Details</h2>
            <dl className="details">
              <dt>Repository</dt>
              <dd className="mono" title={s.repo}>
                {shortRepo(s.repo)}
              </dd>
              {s.branch && (
                <>
                  <dt>Branch</dt>
                  <dd className="mono">{s.branch}</dd>
                </>
              )}
              {s.commit && (
                <>
                  <dt>Commit</dt>
                  <dd className="mono">{s.commit}</dd>
                </>
              )}
              {s.pr_url && (
                <>
                  <dt>Pull request</dt>
                  <dd>
                    <a href={s.pr_url} target="_blank" rel="noreferrer">
                      {prLabel(s.pr_url)}
                    </a>
                  </dd>
                </>
              )}
              {s.assigned_to && (
                <>
                  <dt>For</dt>
                  <dd>{s.assigned_to.name}</dd>
                </>
              )}
              <dt>Shared</dt>
              <dd>{dateTime(s.created_at)}</dd>
              {s.updated_at && (
                <>
                  <dt>Edited</dt>
                  <dd>{dateTime(s.updated_at)}</dd>
                </>
              )}
              {s.expires_at && (
                <>
                  <dt>Expires</dt>
                  <dd>{dateTime(s.expires_at)}</dd>
                </>
              )}
              <dt>Visible to</dt>
              <dd>{s.visibility.team ? "Whole team" : s.people.map((p) => p.name).join(", ") || "Only the author"}</dd>
              <dt>ID</dt>
              <dd className="mono">{s.id}</dd>
            </dl>
            {s.redactions > 0 && (
              <p className="note">
                <Icon name="lock" size={12} /> {s.redactions} secret{s.redactions === 1 ? " was" : "s were"} removed before upload.
              </p>
            )}
          </section>

          {s.files_touched.length > 0 && (
            <section className="card">
              <h2>Files touched</h2>
              <ul className="files">
                {s.files_touched.map((f) => (
                  <li key={f} className="mono" title={f}>
                    <Icon name="file" size={13} />
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canDelete && (
            <section className="danger-zone">
              {confirmDelete ? (
                <div className="confirm">
                  <p>Delete this share for everyone? Handoff files people already pulled are not affected.</p>
                  <div className="row">
                    <button type="button" className="btn-danger btn-sm" onClick={remove}>
                      Delete share
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn-ghost btn-sm danger-text" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={14} /> Delete share
                </button>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
