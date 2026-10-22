import { useEffect, useState } from "react";

// Placeholder until Phase 2 adds sign-in and the session list.
export function App() {
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    fetch("/health")
      .then((r) => setHealth(r.ok ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "48px auto", padding: "0 16px" }}>
      <h1>Session Relay</h1>
      <p>Browse and read the sessions your team has shared. The session list arrives in Phase 2.</p>
      <p>Server: {health}</p>
    </main>
  );
}
