import { Hono } from "hono";
import { OrgPatch, type OrgInfo } from "@session-relay/shared";
import type { AppEnv } from "../auth.js";
import { audit } from "../audit.js";
import type { Sql } from "../db/client.js";
import { parseBody, requireRole } from "../http.js";

export function orgRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const { orgId } = c.get("auth");
    const [r] = await sql`
      SELECT o.id, o.name, o.slug, s.retention_days, s.repo_allowlist, s.redaction_patterns,
        (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id) AS members,
        (SELECT count(*)::int FROM sessions x WHERE x.org_id = o.id AND x.deleted_at IS NULL) AS sessions,
        (SELECT coalesce(sum(coalesce(x.transcript_bytes, 0) + octet_length(x.messages::text)), 0)::bigint
           FROM sessions x WHERE x.org_id = o.id AND x.deleted_at IS NULL) AS storage_bytes
      FROM orgs o JOIN org_settings s ON s.org_id = o.id
      WHERE o.id = ${orgId}
    `;
    const body: OrgInfo = {
      id: r!.id,
      name: r!.name,
      slug: r!.slug,
      settings: { retention_days: r!.retention_days, repo_allowlist: r!.repo_allowlist, redaction_patterns: r!.redaction_patterns },
      stats: { members: r!.members, sessions: r!.sessions, storage_bytes: Number(r!.storage_bytes) },
    };
    return c.json(body);
  });

  app.patch("/", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const patch = parseBody(OrgPatch, await c.req.json());
    await sql.begin(async (tx) => {
      if (patch.name) await tx`UPDATE orgs SET name = ${patch.name} WHERE id = ${auth.orgId}`;
      if (patch.retention_days !== undefined) {
        await tx`UPDATE org_settings SET retention_days = ${patch.retention_days} WHERE org_id = ${auth.orgId}`;
      }
      if (patch.repo_allowlist) {
        await tx`UPDATE org_settings SET repo_allowlist = ${patch.repo_allowlist.map((r) => r.trim().toLowerCase())} WHERE org_id = ${auth.orgId}`;
      }
      if (patch.redaction_patterns) {
        await tx`UPDATE org_settings SET redaction_patterns = ${patch.redaction_patterns} WHERE org_id = ${auth.orgId}`;
      }
    });
    await audit(sql, auth, "org.update", auth.orgId, patch as Record<string, unknown>);
    return c.json({ ok: true });
  });

  return app;
}
