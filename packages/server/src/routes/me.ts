import { Hono } from "hono";
import type { MeResponse } from "@session-relay/shared";
import type { AppEnv } from "../auth.js";
import type { Sql } from "../db/client.js";

export function meRoutes(sql: Sql) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const { orgId, userId, role } = c.get("auth");
    const [row] = await sql`
      SELECT u.name AS user_name, u.email, o.name AS org_name, o.slug AS org_slug,
             s.retention_days, s.repo_allowlist, s.redaction_patterns
      FROM users u, orgs o
      JOIN org_settings s ON s.org_id = o.id
      WHERE u.id = ${userId} AND o.id = ${orgId}
    `;
    const body: MeResponse = {
      user: { id: userId, name: row!.user_name, email: row!.email },
      org: { id: orgId, name: row!.org_name, slug: row!.org_slug },
      role,
      settings: {
        retention_days: row!.retention_days,
        repo_allowlist: row!.repo_allowlist,
        redaction_patterns: row!.redaction_patterns,
      },
    };
    return c.json(body);
  });
}
