import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@session-relay/shared";
import { api, getToken, setToken } from "./api";
import { parseRoute, type Route } from "./format";
import { Login } from "./Login";
import { Members } from "./Members";
import { SessionList } from "./SessionList";
import { SessionView } from "./SessionView";

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [route, setRoute] = useState<Route>(parseRoute(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  if (checking) return <div className="center muted">Loading…</div>;
  if (!me) return <Login onSignedIn={setMe} />;

  return (
    <div className="shell">
      <header className="top">
        <a href="#/" className="brand">
          Session Relay
        </a>
        <nav>
          <a href="#/" className={route.page !== "members" ? "on" : ""}>
            Sessions
          </a>
          <a href="#/members" className={route.page === "members" ? "on" : ""}>
            Members
          </a>
        </nav>
        <div className="who">
          <span>
            {me.user.name} · {me.org.name}
          </span>
          <button type="button" className="link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        {route.page === "list" && <SessionList />}
        {route.page === "session" && <SessionView id={route.id} me={me} />}
        {route.page === "members" && <Members me={me} />}
      </main>
    </div>
  );
}
