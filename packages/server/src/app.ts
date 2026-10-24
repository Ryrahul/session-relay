import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./auth.js";
import { requireAuth } from "./auth.js";
import type { Sql } from "./db/client.js";
import type { BlobStorage } from "./storage/types.js";
import { meRoutes } from "./routes/me.js";
import { activityRoutes } from "./routes/activity.js";
import { orgRoutes } from "./routes/org.js";
import { memberRoutes, tokenRoutes } from "./routes/members.js";
import { sessionRoutes } from "./routes/sessions.js";
import { deviceRoutes } from "./routes/device.js";
import { inviteRoutes, joinRoutes } from "./routes/invites.js";
import { setupRoutes, type SetupGate } from "./setup.js";

export interface AppDeps {
  sql: Sql;
  storage: BlobStorage;
  /** Present while first-run setup is possible (no org yet). */
  setup?: SetupGate | null;
  /** Public URL, used in invite links and browser-login URLs. */
  publicUrl?: string;
  /** Extra routes added before the 404 handler (the Node entry serves the web app here). */
  extend?: (app: Hono<AppEnv>) => void;
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function createApp({ sql, storage, setup = null, publicUrl = "http://localhost:8787", extend }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  // Unauthenticated: only usable with the one-time code while no org exists.
  app.route("/v1/setup", setupRoutes(sql, setup));
  // Unauthenticated: the invite secret / device code is the credential.
  app.route("/v1/join", joinRoutes(sql));
  app.route("/v1/auth/device", deviceRoutes(sql, publicUrl));

  const v1 = new Hono<AppEnv>();
  v1.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "Request too large" }, 413) }));
  v1.use("*", requireAuth(sql));
  v1.route("/me", meRoutes(sql));
  v1.route("/org", orgRoutes(sql));
  v1.route("/members", memberRoutes(sql));
  v1.route("/tokens", tokenRoutes(sql));
  v1.route("/invites", inviteRoutes(sql, publicUrl));
  v1.route("/sessions", sessionRoutes(sql, storage));
  v1.route("/", activityRoutes(sql));
  app.route("/v1", v1);

  extend?.(app);

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
