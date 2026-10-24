import { existsSync } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { AppEnv } from "./auth.js";

/** Node/Docker only: serve the built web app at `/`. (On Cloudflare, Workers Static Assets does this.) */
export function serveWebApp(webDist: string | undefined) {
  return (app: Hono<AppEnv>) => {
    if (!webDist || !existsSync(path.join(webDist, "index.html"))) return;
    const root = path.relative(process.cwd(), webDist) || ".";
    app.use("/*", serveStatic({ root }));
    // Client-side routes fall back to the app shell.
    app.get("*", serveStatic({ root, path: "index.html" }));
  };
}
