import { useEffect, useState } from "react";
import type { MeResponse } from "@session-relay/shared";
import { api } from "../api";
import { Icon } from "../ui";

/** Approve (or deny) a `relay login` from a terminal. */
export function Device({ code, me }: { code: string; me: MeResponse }) {
  const [info, setInfo] = useState<{ client_name: string } | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.deviceInfo(code).then(setInfo, (e) => setError(e.message));
  }, [code]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      await api.deviceDecide(code, approve);
      setResult(approve ? "approved" : "denied");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <section className="card device-card">
        {result === "approved" ? (
          <>
            <h1>
              <Icon name="check" size={20} /> Signed in
            </h1>
            <p className="muted">
              <strong>{info?.client_name}</strong> is now signed in as {me.user.name} in {me.org.name}. You can go back to your terminal.
            </p>
          </>
        ) : result === "denied" ? (
          <>
            <h1>Sign-in denied</h1>
            <p className="muted">The terminal won't be signed in. If you didn't start this, nothing else is needed.</p>
          </>
        ) : error ? (
          <>
            <h1>This code doesn't work</h1>
            <p className="error">{error}</p>
          </>
        ) : !info ? (
          <p className="muted">Checking the code…</p>
        ) : (
          <>
            <h1>Sign in on your computer?</h1>
            <p className="muted">
              <strong>{info.client_name}</strong> wants to sign in to Session Relay as <strong>{me.user.name}</strong> in{" "}
              <strong>{me.org.name}</strong>.
            </p>
            <p className="muted">Only approve if your terminal shows this same code:</p>
            <p className="device-code">{code.toUpperCase()}</p>
            <div className="row">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => decide(true)}>
                Approve
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => decide(false)}>
                Deny
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
