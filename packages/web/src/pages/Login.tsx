import { useState, type FormEvent } from "react";
import type { MeResponse } from "@session-relay/shared";
import { api, setToken } from "../api";
import { Mark, ThemeSwitch } from "../ui";

export function Login({ onSignedIn }: { onSignedIn: (me: MeResponse) => void }) {
  const [token, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const me = await api.me(token.trim());
      setToken(token.trim());
      onSignedIn(me);
    } catch {
      setError("That token wasn't accepted. Check for missing characters, or ask an admin for a new one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-theme">
        <ThemeSwitch />
      </div>
      <div className="login-card">
        <div className="login-brand">
          <Mark size={30} />
          <span>Session Relay</span>
        </div>
        <h1>{location.hash.startsWith("#/device/") ? "Sign in to approve your terminal." : "Pick up where your teammate left off."}</h1>
        <p className="muted">Shared sessions from Claude Code, OpenCode and Codex, in one place for your team.</p>
        <form onSubmit={submit} className="stack">
          <label htmlFor="token">Personal token</label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="srk_…"
            value={token}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "token-error" : "token-help"}
          />
          {error ? (
            <p id="token-error" className="error">
              {error}
            </p>
          ) : (
            <p id="token-help" className="hint">
              Use the same token as the <code>relay</code> CLI. An admin can create one for you on the Members page, or with{" "}
              <code>relay invite</code>.
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !token.trim()}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
