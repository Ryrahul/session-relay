import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/** Client IP as seen through the reverse proxy (nginx/Caddy set X-Forwarded-For). */
export function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
}

/** Small fixed-window limiter for unauthenticated endpoints. In-memory: fine for one server process. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c: Context, next: Next) => {
    const now = Date.now();
    const key = clientIp(c);
    const h = hits.get(key);
    if (!h || now > h.reset) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) throw new HTTPException(429, { message: "Too many requests. Try again in a minute." });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    await next();
  };
}
