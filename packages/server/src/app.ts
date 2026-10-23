import { existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AppEnv } from "./auth.js";
import { requireAuth } from "./auth.js";
import type { Sql } from "./db/client.js";
import type { BlobStorage } from "./storage/index.js";
import { meRoutes } from "./routes/me.js";
import { orgRoutes } from "./routes/org.js";
import { memberRoutes, tokenRoutes } from "./routes/members.js";
import { sessionRoutes } from "./routes/sessions.js";

export interface AppDeps {
  sql: Sql;
  storage: BlobStorage;
  /** Built web app to serve at `/`, if present. */
  webDist?: string;
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function createApp({ sql, storage, webDist }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  v1.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "Request too large" }, 413) }));
  v1.use("*", requireAuth(sql));
  v1.route("/me", meRoutes(sql));
  v1.route("/org", orgRoutes(sql));
  v1.route("/members", memberRoutes(sql));
  v1.route("/tokens", tokenRoutes(sql));
  v1.route("/sessions", sessionRoutes(sql, storage));
  app.route("/v1", v1);

  if (webDist && existsSync(path.join(webDist, "index.html"))) {
    const root = path.relative(process.cwd(), webDist) || ".";
    app.use("/*", serveStatic({ root }));
    // Client-side routes fall back to the app shell.
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
