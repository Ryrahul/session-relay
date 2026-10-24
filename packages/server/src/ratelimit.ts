import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Sql } from "./db/client.js";

/** Client IP as seen through the proxy: Cloudflare, nginx or Caddy. */
export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "local"
  );
}

/**
 * Fixed-window limiter for unauthenticated endpoints, stored in Postgres so it holds
 * across processes. `name` separates limits for different endpoints.
 */
export function rateLimit(sql: Sql, name: string, max: number, windowMs: number) {
  const seconds = Math.ceil(windowMs / 1000);
  return async (c: Context, next: Next) => {
    const key = `${name}:${clientIp(c)}`;
    const [row] = await sql`
      INSERT INTO rate_limits (key, window_start, hits) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${seconds}) THEN 1 ELSE rate_limits.hits + 1 END,
        window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${seconds}) THEN now() ELSE rate_limits.window_start END
      RETURNING hits
    `;
    if (row!.hits > max) throw new HTTPException(429, { message: "Too many requests. Try again in a minute." });
    await next();
  };
}

/** Drops counters whose window ended long ago. Called from the hourly cleanup. */
export async function purgeRateLimits(sql: Sql): Promise<void> {
  await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
}
