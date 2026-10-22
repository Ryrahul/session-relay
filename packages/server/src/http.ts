import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { AuthContext, Role } from "./auth.js";

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HTTPException(400, { message: `Invalid request: ${issue?.path.join(".") || "body"} ${issue?.message}` });
  }
  return parsed.data;
}

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export function requireRole(auth: AuthContext, min: Role): void {
  if (RANK[auth.role] < RANK[min]) throw new HTTPException(403, { message: `Requires ${min} role` });
}

export function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
