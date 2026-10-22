import { useEffect, useState } from "react";
import type { MeResponse, Message, SessionDetail } from "@session-relay/shared";
import { api } from "./api";
import { ago, TOOL_NAMES } from "./format";

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="block">
      <h3>{title}</h3>
      <ul>
        {items.map((i, n) => (
          <li key={n}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function MessageRow({ m }: { m: Message }) {
  return (
    <div className={`msg m-${m.role}`}>
      <span className="role">{m.role}</span>
      <div className="text">{m.text}</div>
    </div>
  );
}

export function SessionView({ id, me }: { id: string; me: MeResponse }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [loadingFull, setLoadingFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setS(null);
    api.get(id, "tail").then(setS, (e) => setError(e.message));
  }, [id]);

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

  async function copyPull() {
    const cmd = `relay pull ${id}`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(`Copy failed. Command: ${cmd}`);
    }
  }

  async function remove() {
    await api.remove(id).then(() => (location.hash = "#/"), (e) => setError(e.message));
  }

  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const canDelete = s.author.id === me.user.id || me.role !== "member";
  const showingAll = s.message_offset === 0 && s.messages.length === s.message_total;

  return (
    <article className="session">
      <a href="#/" className="back">
        ← All sessions
      </a>
      <h1>{s.title}</h1>
      <p className="meta">
        <span className={`tool t-${s.source.tool}`}>{TOOL_NAMES[s.source.tool]}</span> {s.author.name} · {ago(s.created_at)} ·{" "}
        <span className="mono">
          {s.repo}
          {s.branch ? ` @ ${s.branch}` : ""}
          {s.commit ? ` (${s.commit})` : ""}
        </span>
        {!s.visibility.team && <> · visible to {s.people.map((p) => p.name).join(", ") || "you"}</>}
      </p>
      <div className="actions">
        <button type="button" onClick={copyPull}>
          {copied ? "Copied" : `Copy "relay pull ${s.id}"`}
        </button>
        {canDelete &&
          (confirmDelete ? (
            <>
              <span className="muted">Delete for everyone?</span>
              <button type="button" className="danger" onClick={remove}>
                Delete
              </button>
              <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
      </div>

      <div className="block">
        <h3>Goal</h3>
        <p>{s.summary.goal || "Not stated"}</p>
      </div>
      <List title="Decisions" items={s.summary.decisions} />
      <List title="Done" items={s.summary.done} />
      <List title="Next steps" items={s.summary.next} />
      <List title="Open questions" items={s.summary.open_questions} />
      {s.files_touched.length > 0 && (
        <div className="block">
          <h3>Files touched</h3>
          <ul className="mono files">
            {s.files_touched.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="block">
        <h3>
          Conversation{" "}
          <span className="muted">
            {s.message_total === 0
              ? "(summary only)"
              : showingAll
                ? `(all ${s.message_total} messages)`
                : `(last ${s.messages.length} of ${s.message_total})`}
          </span>
        </h3>
        {s.has_full_transcript && !showingAll && (
          <button type="button" className="ghost" onClick={loadFull} disabled={loadingFull}>
            {loadingFull ? "Loading…" : "Load full transcript"}
          </button>
        )}
        <div className="msgs">
          {s.messages.map((m, i) => (
            <MessageRow key={i} m={m} />
          ))}
        </div>
      </div>
      {s.redactions > 0 && <p className="muted small">{s.redactions} secret(s) were removed before upload.</p>}
    </article>
  );
}
