/**
 * Cloudflare Workers entry. Same API as the Node/Docker server (createApp), with:
 * - Postgres through Hyperdrive, transcripts in R2, the web app from Workers Static Assets,
 * - expiry cleanup from a Cron Trigger,
 * - first-run setup only when SETUP_CODE is set (Workers have no startup log to print one),
 * - migrations run from CI / the deploy guide, not at startup.
 * See docs/cloudflare.md.
 */
import postgres from "postgres";
import { createApp } from "./app.js";
import type { Sql } from "./db/client.js";
import { purgeExpired } from "./routes/sessions.js";
import { SetupGate } from "./setup.js";
import { R2Storage, type R2Like } from "./storage/r2.js";

export interface Env {
  HYPERDRIVE: { connectionString: string };
  TRANSCRIPTS: R2Like;
  PUBLIC_URL: string;
  /** Secret. Enables first-run setup with this code until the first org exists. */
  SETUP_CODE?: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

function db(env: Env): Sql {
  // Hyperdrive pools connections; keep the per-request client small. Type fetching stays on:
  // the schema uses text[] columns (files_touched, repo_allowlist, redaction_patterns).
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, onnotice: () => {} });
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const sql = db(env);
    const app = createApp({
      sql,
      storage: new R2Storage(env.TRANSCRIPTS),
      setup: env.SETUP_CODE ? new SetupGate(env.SETUP_CODE) : null,
      publicUrl: env.PUBLIC_URL,
    });
    try {
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }));
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    const sql = db(env);
    ctx.waitUntil(
      purgeExpired(sql, new R2Storage(env.TRANSCRIPTS))
        .then((n) => n && console.log(`Purged ${n} expired session(s)`))
        .finally(() => sql.end({ timeout: 5 })),
    );
  },
};
