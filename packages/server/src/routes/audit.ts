import { Hono } from "hono";
import type { AuditEntry } from "@session-relay/shared";
import type { AppEnv } from "../auth.js";
import type { Sql } from "../db/client.js";
import { requireRole } from "../http.js";

/** GET /v1/audit (admins): who did what, newest first. `before` is the last id seen, for paging. */
export function auditRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const q = c.req.query();
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const before = Number(q.before) || null;
    const rows = await sql`
      SELECT l.id, l.action, l.target_id, l.meta, l.created_at, l.user_id, u.name AS user_name, s.title AS session_title
      FROM audit_log l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN sessions s ON s.id = l.target_id AND s.org_id = l.org_id
      WHERE l.org_id = ${auth.orgId}
        ${before ? sql`AND l.id < ${before}` : sql``}
        ${q.action ? sql`AND l.action LIKE ${q.action.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%"}` : sql``}
        ${q.user ? sql`AND l.user_id = ${q.user}` : sql``}
        ${q.target ? sql`AND l.target_id = ${q.target}` : sql``}
      ORDER BY l.id DESC
      LIMIT ${limit}
    `;
    const entries: AuditEntry[] = rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      user: r.user_id ? { id: r.user_id, name: r.user_name ?? "(removed)" } : null,
      target_id: r.target_id,
      session_title: r.session_title,
      meta: r.meta ?? {},
      created_at: r.created_at.toISOString(),
    }));
    return c.json({ entries, next: entries.length === limit ? entries.at(-1)!.id : null });
  });

  return app;
}
