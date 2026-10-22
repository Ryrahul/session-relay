import { useState, type FormEvent } from "react";
import type { MeResponse } from "@session-relay/shared";
import { api, setToken } from "./api";

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
      setError("That token was not accepted. Check it, or ask an admin for a new one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Session Relay</h1>
        <p className="muted">Sign in with your personal token (the same one the relay CLI uses).</p>
        <label htmlFor="token">Token</label>
        <input id="token" type="password" autoComplete="off" placeholder="srk_…" value={token} onChange={(e) => setValue(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !token.trim()}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
