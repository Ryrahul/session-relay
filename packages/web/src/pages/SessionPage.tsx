import { useEffect, useMemo, useState } from "react";
import type { MeResponse, Message, SessionDetail } from "@session-relay/shared";
import { api } from "../api";
import { ago, dateTime, shortRepo, TOOL_NAMES } from "../format";
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

  useEffect(() => {
    setS(null);
    setError("");
    api.get(id, "tail").then(setS, (e) => setError(e.status === 404 ? "This session doesn't exist, was deleted, or isn't shared with you." : e.message));
  }, [id]);

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
        </div>
        <h1>{s.title}</h1>
        <p className="session-byline">
          <Avatar name={s.author.name} size={22} />
          <span>
            <strong>{s.author.name}</strong> shared from {TOOL_NAMES[s.source.tool]} · {ago(s.created_at)}
          </span>
        </p>
      </header>

      <div className="session-grid">
        <div className="session-main">
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
        </div>

        <aside className="session-side">
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
              <dt>Shared</dt>
              <dd>{dateTime(s.created_at)}</dd>
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
