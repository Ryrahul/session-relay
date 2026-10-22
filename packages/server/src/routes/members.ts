import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { InviteRequest, newId, type Member } from "@session-relay/shared";
import { z } from "zod";
import { generateToken, hashToken, type AppEnv } from "../auth.js";
import { audit } from "../audit.js";
import type { Sql } from "../db/client.js";
import { parseBody, requireRole } from "../http.js";

export function memberRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const { orgId } = c.get("auth");
    const rows = await sql`
      SELECT u.id, u.name, u.email, m.role, m.created_at
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ${orgId}
      ORDER BY u.name
    `;
    const members: Member[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      joined_at: r.created_at.toISOString(),
    }));
    return c.json({ members });
  });

  // Adds someone to the org and returns their first token (shown once).
  app.post("/", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const body = parseBody(InviteRequest, await c.req.json());
    if (body.role === "owner") requireRole(auth, "owner");

    const token = generateToken();
    const result = await sql.begin(async (tx) => {
      // Users are global so one person can belong to several orgs in the hosted version.
      const [existing] = await tx`SELECT id, name FROM users WHERE email = ${body.email}`;
      const userId: string = existing?.id ?? newId("usr");
      if (!existing) await tx`INSERT INTO users (id, email, name) VALUES (${userId}, ${body.email}, ${body.name})`;
      const [dupe] = await tx`SELECT 1 FROM memberships WHERE org_id = ${auth.orgId} AND user_id = ${userId}`;
      if (dupe) throw new HTTPException(409, { message: `${body.email} is already a member` });
      await tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${auth.orgId}, ${userId}, ${body.role})`;
      await tx`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
               VALUES (${newId("tok")}, ${auth.orgId}, ${userId}, ${hashToken(token)}, 'invite')`;
      return { userId, name: existing?.name ?? body.name };
    });
    await audit(sql, auth, "member.add", result.userId, { email: body.email, role: body.role });
    return c.json({ user: { id: result.userId, name: result.name, email: body.email, role: body.role }, token }, 201);
  });

  app.delete("/:userId", async (c) => {
    const auth = c.get("auth");
    requireRole(auth, "admin");
    const userId = c.req.param("userId");
    if (userId === auth.userId) throw new HTTPException(400, { message: "You cannot remove yourself" });
    const [target] = await sql`SELECT role FROM memberships WHERE org_id = ${auth.orgId} AND user_id = ${userId}`;
    if (!target) throw new HTTPException(404, { message: "Member not found" });
    if (target.role === "owner") requireRole(auth, "owner");
    // Tokens and per-person visibility rows cascade from the membership.
    await sql`DELETE FROM memberships WHERE org_id = ${auth.orgId} AND user_id = ${userId}`;
    await audit(sql, auth, "member.remove", userId);
    return c.json({ ok: true });
  });

  return app;
}

export function tokenRoutes(sql: Sql) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const { orgId, userId } = c.get("auth");
    const rows = await sql`
      SELECT id, name, created_at, last_used_at, revoked_at FROM api_tokens
      WHERE org_id = ${orgId} AND user_id = ${userId} ORDER BY created_at DESC
    `;
    return c.json({
      tokens: rows.map((r) => ({
        id: r.id,
        name: r.name,
        created_at: r.created_at.toISOString(),
        last_used_at: r.last_used_at?.toISOString() ?? null,
        revoked: r.revoked_at !== null,
      })),
    });
  });

  app.post("/", async (c) => {
    const auth = c.get("auth");
    const { name } = parseBody(z.object({ name: z.string().min(1).max(60) }), await c.req.json());
    const token = generateToken();
    const id = newId("tok");
    await sql`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
              VALUES (${id}, ${auth.orgId}, ${auth.userId}, ${hashToken(token)}, ${name})`;
    await audit(sql, auth, "token.create", id);
    return c.json({ id, name, token }, 201);
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const rows = await sql`
      UPDATE api_tokens SET revoked_at = now()
      WHERE id = ${id} AND org_id = ${auth.orgId} AND user_id = ${auth.userId} AND revoked_at IS NULL
      RETURNING id
    `;
    if (!rows.length) throw new HTTPException(404, { message: "Token not found" });
    await audit(sql, auth, "token.revoke", id);
    return c.json({ ok: true });
  });

  return app;
}
