import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./auth.js";
import { requireAuth } from "./auth.js";
import type { Sql } from "./db/client.js";
import type { BlobStorage } from "./storage/index.js";
import { meRoutes } from "./routes/me.js";

export interface AppDeps {
  sql: Sql;
  storage: BlobStorage;
}

export function createApp({ sql }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  v1.use("*", requireAuth(sql));
  v1.route("/me", meRoutes(sql));
  // Phase 2: /sessions (share, list, search, get, patch, delete)
  app.route("/v1", v1);

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
