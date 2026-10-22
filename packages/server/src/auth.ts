import { createHash, randomBytes } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { Sql } from "./db/client.js";

export type Role = "owner" | "admin" | "member";

/** Who is calling, and which org every query must be scoped to. */
export interface AuthContext {
  orgId: string;
  userId: string;
  role: Role;
  tokenId: string;
}

export type AppEnv = { Variables: { auth: AuthContext } };

const TOKEN_PREFIX = "srk_";

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function requireAuth(sql: Sql) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token.startsWith(TOKEN_PREFIX)) throw new HTTPException(401, { message: "Missing or malformed token" });

    const [row] = await sql<{ id: string; org_id: string; user_id: string; role: Role }[]>`
      SELECT t.id, t.org_id, t.user_id, m.role
      FROM api_tokens t
      JOIN memberships m ON m.org_id = t.org_id AND m.user_id = t.user_id
      WHERE t.token_hash = ${hashToken(token)} AND t.revoked_at IS NULL
    `;
    if (!row) throw new HTTPException(401, { message: "Invalid or revoked token" });

    await sql`UPDATE api_tokens SET last_used_at = now() WHERE id = ${row.id}`;
    c.set("auth", { orgId: row.org_id, userId: row.user_id, role: row.role, tokenId: row.id });
    await next();
  });
}
