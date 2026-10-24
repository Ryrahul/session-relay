import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@session-relay/shared";
import { api, getToken, setToken } from "./api";
import { parseRoute, type Route } from "./format";
import { Login } from "./pages/Login";
import { Activity } from "./pages/Activity";
import { Members } from "./pages/Members";
import { Stats } from "./pages/Stats";
import { SessionPage } from "./pages/SessionPage";
import { Sessions } from "./pages/Sessions";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Device } from "./pages/Device";
import { Join } from "./pages/Join";
import { Start } from "./pages/Start";
import { Avatar, Icon, Mark, ThemeSwitch, useTheme } from "./ui";

const NAV: { page: Route["page"]; href: string; label: string; icon: string }[] = [
  { page: "sessions", href: "#/", label: "Sessions", icon: "sessions" },
  { page: "activity", href: "#/activity", label: "Activity", icon: "activity" },
  { page: "stats", href: "#/stats", label: "Stats", icon: "stats" },
  { page: "start", href: "#/start", label: "Get started", icon: "start" },
  { page: "members", href: "#/members", label: "Members", icon: "members" },
  { page: "settings", href: "#/settings", label: "Settings", icon: "settings" },
];

export function App() {
  useTheme();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [route, setRoute] = useState<Route>(parseRoute(location.hash));

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const refreshMe = useCallback(() => api.me().then(setMe), []);

  useEffect(() => {
    // A fresh server shows first-run setup; otherwise sign in (or resume the saved session).
    api
      .setupStatus()
      .then((s) => setNeedsSetup(s.needed))
      .catch(() => setNeedsSetup(false))
      .then(() => (getToken() ? refreshMe().catch(() => setToken(null)) : undefined))
      .finally(() => setChecking(false));
  }, [refreshMe]);

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
    if (!location.hash.startsWith("#/device/")) location.hash = "#/";
  }, []);

  if (checking) return <div className="boot" aria-busy="true" />;
  if (route.page === "join" && !me) return <Join key={route.secret} secret={route.secret} onDone={setMe} />;
  if (!me && needsSetup)
    return (
      <Setup
        onDone={(m) => {
          setNeedsSetup(false);
          setMe(m);
        }}
      />
    );
  if (!me) return <Login onSignedIn={setMe} />;

  const active = route.page === "session" || route.page === "device" || route.page === "join" ? "sessions" : route.page;

  return (
    <div className="app">
      <aside className="sidebar">
        <a href="#/" className="brand">
          <Mark />
          <span>Session Relay</span>
        </a>
        <div className="org-name" title={me.org.name}>
          {me.org.name}
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.page} href={n.href} className={active === n.page ? "on" : ""} aria-current={active === n.page ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <Avatar name={me.user.name} size={28} />
            <div className="me-text">
              <span className="me-name">{me.user.name}</span>
              <span className="me-role">{me.role}</span>
            </div>
            <button type="button" className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
              <Icon name="out" />
            </button>
          </div>
          <ThemeSwitch />
        </div>
      </aside>
      <main className="content">
        {(route.page === "sessions" || route.page === "join") && <Sessions me={me} />}
        {route.page === "device" && <Device key={route.code} code={route.code} me={me} />}
        {route.page === "session" && <SessionPage id={route.id} me={me} />}
        {route.page === "activity" && <Activity me={me} />}
        {route.page === "stats" && <Stats />}
        {route.page === "start" && <Start me={me} />}
        {route.page === "members" && <Members me={me} />}
        {route.page === "settings" && <Settings me={me} onOrgChanged={refreshMe} />}
      </main>
    </div>
  );
}
