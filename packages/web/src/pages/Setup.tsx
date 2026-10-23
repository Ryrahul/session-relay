import { useState, type FormEvent } from "react";
import type { MeResponse } from "@session-relay/shared";
import { api, setToken } from "../api";
import { Command, Mark, ThemeSwitch } from "../ui";

/** First-run setup: create the first org and its owner with the code from the server logs. */
export function Setup({ onDone }: { onDone: (me: MeResponse) => void }) {
  const [code, setCode] = useState("");
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; me: MeResponse } | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.setup({ code: code.trim(), org: org.trim(), name: name.trim(), email: email.trim() });
      const me = await api.me(res.token);
      setToken(res.token);
      setCreated({ token: res.token, me });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const server = location.origin;
    return (
      <div className="login-page">
        <div className="login-card setup-card">
          <div className="login-brand">
            <Mark size={30} />
            <span>Session Relay</span>
          </div>
          <h1>{created.me.org.name} is ready.</h1>
          <p className="muted">
            You're the owner. This is your personal token. It's shown <strong>only once</strong>, so save it in your password manager now.
          </p>
          <div className="stack">
            <label>Your owner token</label>
            <Command>{created.token}</Command>
            <label>Log in from your laptop</label>
            <Command>{`npm install -g session-relay\nrelay login --server ${server} --token ${created.token}\nrelay setup`}</Command>
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my token
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!saved}
            onClick={() => {
              location.hash = "#/members";
              onDone(created.me);
            }}
          >
            Continue and add my team
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-theme">
        <ThemeSwitch />
      </div>
      <div className="login-card setup-card">
        <div className="login-brand">
          <Mark size={30} />
          <span>Session Relay</span>
        </div>
        <h1>Set up Session Relay</h1>
        <p className="muted">
          This server is new. Create your organization and your owner account. You can rename the organization later in Settings.
        </p>
        <form onSubmit={submit} className="stack">
          <label htmlFor="setup-code">Setup code</label>
          <input
            id="setup-code"
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            className="mono"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <p className="hint">
            Printed in the server logs when it started. Run <code>docker compose logs server</code> on the server to see it.
          </p>
          <label htmlFor="setup-org">Organization name</label>
          <input id="setup-org" placeholder="e.g. Acme" value={org} onChange={(e) => setOrg(e.target.value)} required maxLength={100} />
          <label htmlFor="setup-name">Your name</label>
          <input id="setup-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          <label htmlFor="setup-email">Your email</label>
          <input id="setup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Setting up…" : "Create organization"}
          </button>
        </form>
      </div>
    </div>
  );
}
