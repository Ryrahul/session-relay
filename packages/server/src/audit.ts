import type { Sql } from "./db/client.js";
import type { AuthContext } from "./auth.js";

export async function audit(
  sql: Sql,
  auth: AuthContext,
  action: string,
  targetId?: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await sql`
    INSERT INTO audit_log (org_id, user_id, action, target_id, meta)
    VALUES (${auth.orgId}, ${auth.userId}, ${action}, ${targetId ?? null}, ${sql.json(meta as never)})
  `;
}

export async function recordUsage(sql: Sql, auth: AuthContext, kind: string, bytes = 0): Promise<void> {
  await sql`
    INSERT INTO usage_events (org_id, user_id, kind, bytes)
    VALUES (${auth.orgId}, ${auth.userId}, ${kind}, ${bytes})
  `;
}
