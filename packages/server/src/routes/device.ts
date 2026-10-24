import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { newId, type DeviceStart } from "@session-relay/shared";
import { z } from "zod";
import { generateToken, hashToken, requireAuth, type AppEnv } from "../auth.js";
import { audit } from "../audit.js";
import type { Sql } from "../db/client.js";
import { parseBody } from "../http.js";
import { rateLimit } from "../ratelimit.js";

const EXPIRES_SECONDS = 600;
const INTERVAL_SECONDS = 3;
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"; // no vowels: no accidental words

function userCode(): string {
  const b = randomBytes(8);
  const s = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

/**
 * Browser login for the CLI.
 * 1. CLI: POST /v1/auth/device → device_code (secret, kept by the CLI) + user_code (shown to the person).
 * 2. Person, signed in on the web: approves the user_code (POST /v1/auth/device/approve).
 * 3. CLI: polls POST /v1/auth/device/token with device_code → once approved, gets a new personal token, once.
 */
export function deviceRoutes(sql: Sql, publicUrl: string) {
  const app = new Hono<AppEnv>();
  const base = publicUrl.replace(/\/$/, "");

  app.post("/", rateLimit(20, 60_000), async (c) => {
    const { client_name } = parseBody(z.object({ client_name: z.string().trim().min(1).max(80).default("relay CLI") }), await c.req.json().catch(() => ({})));
    const deviceCode = "dev_" + randomBytes(32).toString("base64url");
    const code = userCode();
    await sql`
      INSERT INTO device_logins (id, device_code_hash, user_code, client_name, expires_at)
      VALUES (${newId("tok").replace("tok_", "dl_")}, ${hashToken(deviceCode)}, ${code}, ${client_name},
              now() + make_interval(secs => ${EXPIRES_SECONDS}))
    `;
    await sql`DELETE FROM device_logins WHERE expires_at < now() - interval '1 day'`;
    const body: DeviceStart = {
      device_code: deviceCode,
      user_code: code,
      verification_url: `${base}/#/device/${code}`,
      interval: INTERVAL_SECONDS,
      expires_in: EXPIRES_SECONDS,
    };
    return c.json(body, 201);
  });

  app.post("/token", rateLimit(60, 60_000), async (c) => {
    const { device_code } = parseBody(z.object({ device_code: z.string().min(10).max(200) }), await c.req.json().catch(() => ({})));
    const hash = hashToken(device_code);
    const result = await sql.begin(async (tx) => {
      const [d] = await tx`SELECT * FROM device_logins WHERE device_code_hash = ${hash} FOR UPDATE`;
      if (!d) return { status: 404, body: { error: "Unknown login request" } };
      if (d.status === "consumed") return { status: 410, body: { error: "This login was already completed" } };
      if (d.status === "denied") return { status: 403, body: { status: "denied", error: "The sign-in was denied in the browser" } };
      if (d.expires_at < new Date()) return { status: 410, body: { status: "expired", error: "The code expired. Run relay login again." } };
      if (d.status === "pending") return { status: 202, body: { status: "pending" } };
      // approved: mint the token now, hand it out exactly once
      const [member] = await tx`SELECT 1 FROM memberships WHERE org_id = ${d.org_id} AND user_id = ${d.user_id}`;
      if (!member) return { status: 403, body: { error: "The approving account is no longer a member" } };
      const token = generateToken();
      await tx`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
               VALUES (${newId("tok")}, ${d.org_id}, ${d.user_id}, ${hashToken(token)}, ${"CLI · " + d.client_name})`;
      await tx`UPDATE device_logins SET status = 'consumed' WHERE id = ${d.id}`;
      return { status: 200, body: { status: "approved", token } };
    });
    return c.json(result.body, result.status as 200);
  });

  // The rest needs a signed-in user (the browser).
  const authed = new Hono<AppEnv>();
  authed.use("*", requireAuth(sql));

  authed.get("/:code", async (c) => {
    const [d] = await sql`SELECT client_name, status, expires_at, created_at FROM device_logins WHERE user_code = ${normalise(c.req.param("code"))}`;
    if (!d || d.status !== "pending" || d.expires_at < new Date()) {
      throw new HTTPException(404, { message: "This code is invalid, already used or expired. Run relay login again." });
    }
    return c.json({ client_name: d.client_name, expires_at: d.expires_at.toISOString(), created_at: d.created_at.toISOString() });
  });

  const decide = (status: "approved" | "denied") => async (c: import("hono").Context<AppEnv>) => {
    const auth = c.get("auth");
    const { user_code } = parseBody(z.object({ user_code: z.string().min(4).max(20) }), await c.req.json().catch(() => ({})));
    const rows = await sql`
      UPDATE device_logins SET status = ${status}, org_id = ${auth.orgId}, user_id = ${auth.userId}
      WHERE user_code = ${normalise(user_code)} AND status = 'pending' AND expires_at > now()
      RETURNING id, client_name
    `;
    if (!rows.length) throw new HTTPException(404, { message: "This code is invalid, already used or expired. Run relay login again." });
    await audit(sql, auth, `device.${status === "approved" ? "approve" : "deny"}`, rows[0]!.id, { client: rows[0]!.client_name });
    return c.json({ ok: true, client_name: rows[0]!.client_name });
  };
  authed.post("/approve", decide("approved"));
  authed.post("/deny", decide("denied"));

  app.route("/", authed);
  return app;
}
