import { Hono } from "hono";
import { matchTemplate, OrgPatch, type OrgInfo } from "@session-relay/shared";
import type { AppEnv } from "../auth.js";
import { audit } from "../audit.js";
import type { Sql } from "../db/client.js";
import { parseBody, requireRole } from "../http.js";

export function orgRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const { orgId } = c.get("auth");
    const [r] = await sql`
      SELECT o.id, o.name, o.slug, s.retention_days, s.repo_allowlist, s.redaction_patterns, s.share_templates, s.live_autonomy,
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
      settings: {
        retention_days: r!.retention_days,
        repo_allowlist: r!.repo_allowlist,
        redaction_patterns: r!.redaction_patterns,
        share_templates: r!.share_templates,
        live_autonomy: r!.live_autonomy,
      },
      stats: { members: r!.members, sessions: r!.sessions, storage_bytes: Number(r!.storage_bytes) },
    };
    return c.json(body);
  });

  /** GET /v1/org/template?repo=: the handoff template that applies to a repo, or null. */
  app.get("/template", async (c) => {
    const { orgId } = c.get("auth");
    const [r] = await sql`SELECT share_templates FROM org_settings WHERE org_id = ${orgId}`;
    return c.json({ template: matchTemplate(r?.share_templates ?? [], c.req.query("repo") ?? "") });
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
      if (patch.share_templates) {
        await tx`UPDATE org_settings SET share_templates = ${tx.json(patch.share_templates)} WHERE org_id = ${auth.orgId}`;
      }
      if (patch.live_autonomy !== undefined) {
        await tx`UPDATE org_settings SET live_autonomy = ${patch.live_autonomy} WHERE org_id = ${auth.orgId}`;
        // Turning it off takes effect at once, for live sessions already running too.
        if (!patch.live_autonomy) await tx`UPDATE live_sessions SET autonomy = false WHERE org_id = ${auth.orgId} AND autonomy`;
      }
      if (patch.redaction_patterns) {
        await tx`UPDATE org_settings SET redaction_patterns = ${patch.redaction_patterns} WHERE org_id = ${auth.orgId}`;
      }
    });
    // Templates can be long; the audit log only needs to know they changed.
    const { share_templates, ...rest } = patch;
    await audit(sql, auth, "org.update", auth.orgId, { ...rest, ...(share_templates ? { share_templates: share_templates.length } : {}) });
    return c.json({ ok: true });
  });

  return app;
}
