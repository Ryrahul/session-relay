import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import type { Sql } from "../db/client.js";

export function meRoutes(sql: Sql) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const { orgId, userId, role } = c.get("auth");
    const [row] = await sql<{ user_name: string; email: string; org_name: string; org_slug: string }[]>`
      SELECT u.name AS user_name, u.email, o.name AS org_name, o.slug AS org_slug
      FROM users u, orgs o
      WHERE u.id = ${userId} AND o.id = ${orgId}
    `;
    return c.json({
      user: { id: userId, name: row?.user_name, email: row?.email },
      org: { id: orgId, name: row?.org_name, slug: row?.org_slug },
      role,
    });
  });
}
