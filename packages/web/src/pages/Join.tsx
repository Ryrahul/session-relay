import { useEffect, useState, type FormEvent } from "react";
import type { JoinInfo, MeResponse } from "@session-relay/shared";
import { api, setToken } from "../api";
import { Command, Mark, ThemeSwitch } from "../ui";

/** Accept an invite link: create your account in the org and get your token once. */
export function Join({ secret, onDone }: { secret: string; onDone: (me: MeResponse) => void }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ token: string; me: MeResponse } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.joinInfo(secret).then(setInfo, (e) => setError(e.message));
  }, [secret]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.join(secret, name.trim(), email.trim());
      const me = await api.me(r.token);
      setToken(r.token);
      setDone({ token: r.token, me });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="login-page">
      <div className="login-theme">
        <ThemeSwitch />
      </div>
      <div className="login-card setup-card">
        <div className="login-brand">
          <Mark size={30} />
          <span>Session Relay</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (done) {
    return shell(
      <>
        <h1>Welcome to {done.me.org.name}.</h1>
        <p className="muted">
          You're in as <strong>{done.me.role}</strong>. Connect your laptop and agents with these commands; <code>relay login</code> signs in through
          this browser.
        </p>
        <Command>{`npm install -g session-relay\nrelay login --server ${location.origin}\nrelay setup`}</Command>
        <details className="token-details">
          <summary>Show my token (for scripts, or logging in without a browser)</summary>
          <p className="hint">Shown only once. You can always create new tokens in Settings → Tokens.</p>
          <Command>{done.token}</Command>
        </details>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Got it
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={!saved}
          onClick={() => {
            location.hash = "#/start";
            onDone(done.me);
          }}
        >
          Continue
        </button>
      </>,
    );
  }

  if (!info) {
    return shell(
      error ? (
        <>
          <h1>This invite doesn't work.</h1>
          <p className="error">{error}</p>
          <a href="#/" className="btn-ghost">
            Go to sign in
          </a>
        </>
      ) : (
        <p className="muted">Checking your invite…</p>
      ),
    );
  }

  return shell(
    <>
      <h1>Join {info.org}</h1>
      <p className="muted">
        You've been invited as <strong>{info.role}</strong>. The link works once and expires{" "}
        {new Date(info.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}.
      </p>
      <form onSubmit={submit} className="stack">
        <label htmlFor="join-name">Your name</label>
        <input id="join-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <label htmlFor="join-email">Your email</label>
        <input id="join-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <p className="hint">Only used to show teammates who shared what. It doesn't need to match any of your coding-agent accounts.</p>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Joining…" : `Join ${info.org}`}
        </button>
      </form>
    </>,
  );
}
