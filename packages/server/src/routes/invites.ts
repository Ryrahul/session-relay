import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CreateInvite, JoinRequest, newId, type InviteInfo, type JoinInfo } from "@session-relay/shared";
import { generateToken, hashToken, type AppEnv } from "../auth.js";
import { audit } from "../audit.js";
import type { Sql } from "../db/client.js";
import { parseBody, requireRole } from "../http.js";
import { rateLimit } from "../ratelimit.js";

const secret = () => "inv_" + randomBytes(24).toString("base64url");

/** Admin side: create, list and revoke invite links. Mounted under the authenticated /v1. */
export function inviteRoutes(sql: Sql, publicUrl: string) {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const body = parseBody(CreateInvite, await c.req.json().catch(() => ({})));
    if (body.role === "owner") requireRole(auth, "owner");
    const s = secret();
    const id = newId("tok").replace("tok_", "inv_");
    const [row] = await sql`
      INSERT INTO invites (id, org_id, created_by, role, secret_hash, note, expires_at)
      VALUES (${id}, ${auth.orgId}, ${auth.userId}, ${body.role}, ${hashToken(s)}, ${body.note ?? null},
              now() + make_interval(days => ${body.expires_days}))
      RETURNING expires_at
    `;
    await audit(sql, auth, "invite.create", id, { role: body.role, expires_days: body.expires_days });
    return c.json({ id, url: `${publicUrl.replace(/\/$/, "")}/#/join/${s}`, role: body.role, expires_at: row!.expires_at.toISOString() }, 201);
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const rows = await sql`
      SELECT i.*, cu.name AS creator, uu.name AS user_name
      FROM invites i LEFT JOIN users cu ON cu.id = i.created_by LEFT JOIN users uu ON uu.id = i.used_by
      WHERE i.org_id = ${auth.orgId} AND i.created_at > now() - interval '30 days'
      ORDER BY i.created_at DESC LIMIT 50
    `;
    const invites: InviteInfo[] = rows.map((r) => ({
      id: r.id,
      role: r.role,
      note: r.note,
      created_by: r.creator,
      expires_at: r.expires_at.toISOString(),
      created_at: r.created_at.toISOString(),
      status: r.revoked_at ? "revoked" : r.used_at ? "used" : r.expires_at < new Date() ? "expired" : "pending",
      used_by: r.user_name,
    }));
    return c.json({ invites });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const rows = await sql`
      UPDATE invites SET revoked_at = now()
      WHERE id = ${c.req.param("id")} AND org_id = ${auth.orgId} AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `;
    if (!rows.length) throw new HTTPException(404, { message: "No pending invite with that id" });
    await audit(sql, auth, "invite.revoke", rows[0]!.id);
    return c.json({ ok: true });
  });

  return app;
}

/** Public side: look at an invite and accept it. No auth; the secret in the link is the credential. */
export function joinRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();
  app.use("*", rateLimit(sql, "join", 30, 60_000));

  const live = (s: string) => sql`
    SELECT i.id, i.org_id, i.role, i.expires_at, o.name AS org_name
    FROM invites i JOIN orgs o ON o.id = i.org_id
    WHERE i.secret_hash = ${hashToken(s)} AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  `;
  const gone = () => new HTTPException(404, { message: "This invite link is invalid, already used, revoked or expired. Ask an admin for a new one." });

  app.get("/:secret", async (c) => {
    const [i] = await live(c.req.param("secret"));
    if (!i) throw gone();
    const body: JoinInfo = { org: i.org_name, role: i.role, expires_at: i.expires_at.toISOString() };
    return c.json(body);
  });

  app.post("/:secret", async (c) => {
    const body = parseBody(JoinRequest, await c.req.json().catch(() => ({})));
    const hash = hashToken(c.req.param("secret"));
    const token = generateToken();
    const out = await sql.begin(async (tx) => {
      // Claim the invite atomically: only one request can use it.
      const [i] = await tx`
        UPDATE invites SET used_at = now()
        WHERE secret_hash = ${hash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, org_id, role
      `;
      if (!i) throw gone();
      const [existing] = await tx`SELECT id FROM users WHERE email = ${body.email}`;
      const userId: string = existing?.id ?? newId("usr");
      if (!existing) await tx`INSERT INTO users (id, email, name) VALUES (${userId}, ${body.email}, ${body.name})`;
      const [member] = await tx`SELECT 1 FROM memberships WHERE org_id = ${i.org_id} AND user_id = ${userId}`;
      if (member) throw new HTTPException(409, { message: `${body.email} is already a member. Sign in with your token, or ask an admin for a new one.` });
      await tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${i.org_id}, ${userId}, ${i.role})`;
      await tx`UPDATE invites SET used_by = ${userId} WHERE id = ${i.id}`;
      await tx`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
               VALUES (${newId("tok")}, ${i.org_id}, ${userId}, ${hashToken(token)}, 'invite link')`;
      await tx`INSERT INTO audit_log (org_id, user_id, action, target_id, meta)
               VALUES (${i.org_id}, ${userId}, 'invite.accept', ${i.id}, ${tx.json({ role: i.role })})`;
      return { orgId: i.org_id as string, role: i.role as string };
    });
    return c.json({ token, role: out.role }, 201);
  });

  return app;
}
