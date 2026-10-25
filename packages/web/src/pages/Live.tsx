import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { LiveDetail, LiveMessage, LiveSession, MeResponse } from "@session-relay/shared";
import { api } from "../api";
import { ago, shortRepo } from "../format";
import { RichText } from "../text";
import { Avatar, Command, Empty, Icon, ToolBadge } from "../ui";

/** Re-runs `load` every `ms` while the tab is visible (and once when it becomes visible again). */
function usePolling(load: () => void, ms: number) {
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), ms);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, ms]);
}

function StateDot({ state }: { state: LiveSession["state"] }) {
  const label = state === "live" ? "Active" : state === "away" ? "Away" : "Ended";
  return <span className={`live-dot live-dot-${state}`} title={label} aria-label={label} />;
}

function LiveCard({ l, me }: { l: LiveSession; me: MeResponse }) {
  const mine = l.owner.id === me.user.id;
  return (
    <li>
      <a href={`#/live/${l.id}`} className="card live-card">
        <div className="live-card-head">
          <Avatar name={l.owner.name} size={30} />
          <div className="live-card-who">
            <strong>
              {l.owner.name}
              {mine && <span className="faint"> (you)</span>}
            </strong>
            <span className="faint small">
              <StateDot state={l.state} /> {l.state === "live" ? "active" : "away"} {ago(l.heartbeat_at)}
            </span>
          </div>
          <div className="live-card-badges">
            {l.tool && <ToolBadge tool={l.tool} />}
            {mine && l.unread > 0 && <span className="badge badge-accent">{l.unread} new</span>}
          </div>
        </div>
        <div className="live-card-what">
          {l.title ? <span className="live-title">{l.title}</span> : <span className="faint">No title</span>}
          {l.status && <span className="muted small">Now: {l.status}</span>}
        </div>
        <div className="live-card-meta faint small">
          <span>
            <Icon name="branch" size={12} /> {l.branch ?? "no branch"}
          </span>
          {l.autonomy && <span className="badge">Acts on messages without asking</span>}
        </div>
        {l.files.length > 0 && (
          <div className="live-files">
            {l.files.slice(0, 4).map((f) => (
              <code key={f.path} title={`${f.path} · ${ago(f.at)}`}>
                {f.path.split("/").slice(-2).join("/")}
              </code>
            ))}
            {l.files.length > 4 && <span className="faint small">+{l.files.length - 4}</span>}
          </div>
        )}
      </a>
    </li>
  );
}

function HowToStart() {
  return (
    <div className="live-how">
      <p className="muted">
        Run <code>/live</code> in Claude Code, Codex, OpenCode, Gemini CLI, Copilot CLI, Cursor or ZCode (or <code>relay live start</code> in the repo). Teammates then see what
        you're working on and which files you touch, and can send messages that reach your agent between its steps.
      </p>
      <p className="muted small">To have messages arrive in Claude Code and Gemini CLI on their own, turn on the live hooks once:</p>
      <Command>relay setup --live on</Command>
    </div>
  );
}

/** Everyone working live right now, grouped by repo. */
export function Live({ me }: { me: MeResponse }) {
  const [live, setLive] = useState<LiveSession[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api
      .liveList()
      .then((r) => {
        setLive(r.live);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  usePolling(load, 10_000);

  const byRepo = new Map<string, LiveSession[]>();
  for (const l of live ?? []) byRepo.set(l.repo, [...(byRepo.get(l.repo) ?? []), l]);
  const repos = [...byRepo].sort((a, b) => Number(b[1].some((l) => l.owner.id === me.user.id)) - Number(a[1].some((l) => l.owner.id === me.user.id)) || b[1].length - a[1].length);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Live</h1>
          <p className="muted">Who's working right now, on what, and which files they're touching.</p>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {live === null && !error && <div className="skeleton-list" aria-busy="true" />}
      {live?.length === 0 && (
        <Empty title="Nobody is working live right now">
          <HowToStart />
        </Empty>
      )}
      {repos.map(([repo, rows]) => (
        <section key={repo} className="live-repo" aria-label={repo}>
          <h2 className="group-label" title={repo}>
            {shortRepo(repo)} <span className="faint">· {rows.length} live</span>
          </h2>
          <ul className="live-grid">
            {rows.map((l) => (
              <LiveCard key={l.id} l={l} me={me} />
            ))}
          </ul>
        </section>
      ))}
      {live && live.length > 0 && (
        <details className="card live-help">
          <summary>How to join in</summary>
          <HowToStart />
        </details>
      )}
    </div>
  );
}

function MessageItem({ m, me, onReply }: { m: LiveMessage; me: MeResponse; onReply?: (m: LiveMessage) => void }) {
  const mineSent = m.from.id === me.user.id;
  return (
    <li className={`comment live-msg ${mineSent ? "live-msg-out" : ""}`} id={`m${m.id}`}>
      <Avatar name={m.from.name} size={26} />
      <div className="comment-body">
        <div className="comment-head">
          <strong>{mineSent ? "You" : m.from.name}</strong>
          {m.from_agent && <span className="badge">agent</span>}
          {!mineSent || m.to.id === me.user.id ? null : <span className="faint">to {m.to.name}</span>}
          {m.kind === "question" && <span className="badge badge-accent">Question</span>}
          {m.kind === "answer" && m.reply_to && (
            <a className="badge" href={`#m${m.reply_to}`} onClick={(e) => (e.preventDefault(), document.getElementById(`m${m.reply_to}`)?.scrollIntoView({ block: "center" }))}>
              Answer to #{m.reply_to}
            </a>
          )}
          <span className="faint">
            #{m.id} · {ago(m.created_at)}
          </span>
          {mineSent && <span className="faint small push">{m.read ? "Seen" : "Not seen yet"}</span>}
          {onReply && !mineSent && (
            <button type="button" className="btn-link push" onClick={() => onReply(m)}>
              Reply
            </button>
          )}
        </div>
        <RichText text={m.body} />
      </div>
    </li>
  );
}

/** One live session: who, where, files, and the messages between you and them. */
export function LivePage({ id, me }: { id: string; me: MeResponse }) {
  const [d, setD] = useState<LiveDetail | null>(null);
  const [myLive, setMyLive] = useState<LiveSession[]>([]);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [question, setQuestion] = useState(false);
  const [replyTo, setReplyTo] = useState<LiveMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    Promise.all([api.liveGet(id), api.liveList()])
      .then(([detail, list]) => {
        setD(detail);
        setMyLive(list.live.filter((l) => l.owner.id === me.user.id));
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [id, me.user.id]);
  usePolling(load, 5_000);

  if (error && !d) return <div className="page"><p className="error">{error}</p></div>;
  if (!d) return <div className="page"><div className="skeleton-list" aria-busy="true" /></div>;

  const mine = d.owner.id === me.user.id;
  const canEnd = mine || me.role !== "member";
  const ended = d.state === "ended";
  // Messages go from my live session in the same repo, if I have one, so answers come back to my agent.
  const fromLive = mine ? d.id : myLive.find((l) => l.repo === d.repo)?.id;
  const canWrite = !ended && (!mine || replyTo);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || !d) return;
    setBusy(true);
    setNote("");
    try {
      const target = replyTo ? (replyTo.from_live ? { to_live: replyTo.from_live } : { to_user: replyTo.from.id }) : { to_live: d.id };
      await api.liveSend({ ...target, from_live: fromLive, body: body.trim(), kind: replyTo ? "answer" : question ? "question" : "message", reply_to: replyTo?.id });
      setBody("");
      setReplyTo(null);
      setQuestion(false);
      load();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setAutonomy(on: boolean) {
    try {
      await api.liveUpdate(d!.id, { autonomy: on });
      load();
    } catch (err) {
      setNote((err as Error).message);
    }
  }

  async function end() {
    if (!confirm(mine ? "End your live session? Teammates stop seeing it and messages stop arriving." : `End ${d!.owner.name}'s live session?`)) return;
    try {
      await api.liveEnd(d!.id);
      load();
    } catch (err) {
      setNote((err as Error).message);
    }
  }

  async function markRead() {
    try {
      await api.liveRead(d!.id);
      load();
    } catch (err) {
      setNote((err as Error).message);
    }
  }

  return (
    <div className="page">
      <a href="#/live" className="back faint small">
        ← Live
      </a>
      <header className="page-head">
        <div className="live-head">
          <Avatar name={d.owner.name} size={40} />
          <div>
            <h1>
              {mine ? "Your live session" : d.owner.name}
              {d.title && <span className="muted"> · {d.title}</span>}
            </h1>
            <p className="muted small">
              <StateDot state={d.state} /> {ended ? `ended ${ago(d.ended_at!)}` : `${d.state === "live" ? "active" : "away"} ${ago(d.heartbeat_at)}`} · {d.repo}
              {d.branch && ` · ${d.branch}`} · started {ago(d.started_at)}
            </p>
          </div>
        </div>
        <div className="head-actions">
          {d.tool && <ToolBadge tool={d.tool} />}
          {canEnd && !ended && (
            <button type="button" className="btn-ghost btn-sm" onClick={end}>
              End live session
            </button>
          )}
        </div>
      </header>

      {d.status && (
        <section className="card card-next">
          <h2>Working on now</h2>
          <p>{d.status}</p>
        </section>
      )}

      {mine && !ended && (
        <section className="card">
          <h2>When teammates send you a message</h2>
          <label className="live-autonomy">
            <span className="switch">
              <input type="checkbox" checked={d.autonomy} disabled={!me.settings.live_autonomy && !d.autonomy} onChange={(e) => setAutonomy(e.target.checked)} />
              <span />
            </span>
            <span>
              <strong>Let my agent act on them without asking me</strong>
              <span className="hint">
                {d.autonomy
                  ? "On: your agent may act on teammates' messages when they fit the current task, and tells you what it did. It still won't push, deploy or run destructive commands because a message asks."
                  : "Off: your agent shows each message to you and asks before acting on it."}
                {!me.settings.live_autonomy && " Your org's admins have turned this off."}
              </span>
            </span>
          </label>
        </section>
      )}

      {d.files.length > 0 && (
        <section className="card">
          <h2>
            <Icon name="file" /> Files touched recently
          </h2>
          <ul className="live-file-list">
            {d.files.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code> <span className="faint small">{ago(f.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="comments" aria-labelledby="live-thread">
        <div className="live-thread-head">
          <h2 id="live-thread">
            Messages <span className="muted">{d.messages.length || ""}</span>
          </h2>
          {mine && d.unread > 0 && (
            <button type="button" className="btn-link" onClick={markRead} title="Your agent won't get these if you mark them read">
              Mark {d.unread} as read
            </button>
          )}
        </div>
        {d.messages.length === 0 && (
          <p className="muted small">
            {mine ? "No messages yet. Teammates' messages reach your agent between its steps." : `No messages between you and ${d.owner.name} yet.`}
          </p>
        )}
        <ol className="comment-list">
          {d.messages.map((m) => (
            <MessageItem
              key={m.id}
              m={m}
              me={me}
              onReply={
                ended
                  ? undefined
                  : (msg) => {
                      setReplyTo(msg);
                      box.current?.focus();
                    }
              }
            />
          ))}
        </ol>
        {canWrite ? (
          <form className="comment-form" onSubmit={send}>
            {replyTo && (
              <p className="small muted">
                Replying to #{replyTo.id} from {replyTo.from.name}.{" "}
                <button type="button" className="btn-link" onClick={() => setReplyTo(null)}>
                  Cancel
                </button>
              </p>
            )}
            <label htmlFor="live-body" className="sr-only">
              Your message
            </label>
            <textarea
              id="live-body"
              ref={box}
              rows={2}
              maxLength={4000}
              placeholder={replyTo ? "Your answer" : `Message ${d.owner.name}'s session: a change that affects them, or a question`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
              }}
            />
            {note && <p className="error">{note}</p>}
            <div className="row live-send-row">
              <button type="submit" className="btn-primary btn-sm" disabled={busy || !body.trim()}>
                {busy ? "Sending…" : "Send"}
              </button>
              {!replyTo && (
                <label className="small muted live-ask">
                  <input type="checkbox" checked={question} onChange={(e) => setQuestion(e.target.checked)} /> It's a question
                </label>
              )}
              <span className="faint small push">
                {d.autonomy && !mine ? "Their agent may act on it without asking them." : "Their agent shows it to them first."} Don't paste secrets.
              </span>
            </div>
          </form>
        ) : (
          !ended && mine && <p className="faint small">Use Reply on a message to answer it.</p>
        )}
        {note && !canWrite && <p className="error">{note}</p>}
      </section>
    </div>
  );
}
