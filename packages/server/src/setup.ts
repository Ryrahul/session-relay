import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./auth.js";
import type { Sql } from "./db/client.js";
import { parseBody } from "./http.js";
import { createOrgWithOwner } from "./orgs.js";
import { rateLimit } from "./ratelimit.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
/** Any fixed number: serialises concurrent first-run setups. */
const SETUP_LOCK_KEY = 7_142_001;

export function generateSetupCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digest = (code: string) => createHash("sha256").update(normalise(code)).digest();

/**
 * One-time first-run setup. While no org exists, whoever has the code printed in the
 * server logs can create the first org and its owner from the web app.
 */
export class SetupGate {
  private readonly hash: Buffer;
  private failures = 0;
  private lockedUntil = 0;
  done = false;

  constructor(code: string) {
    this.hash = digest(code);
  }

  check(code: string, now = Date.now()): void {
    if (now < this.lockedUntil) {
      throw new HTTPException(429, { message: "Too many wrong setup codes. Wait 15 minutes, or restart the server for a new code." });
    }
    if (!timingSafeEqual(digest(code), this.hash)) {
      this.failures += 1;
      if (this.failures >= MAX_FAILURES) {
        this.lockedUntil = now + LOCK_MS;
        this.failures = 0;
      }
      throw new HTTPException(403, { message: "That setup code is not right. It's printed in the server logs." });
    }
  }
}

export async function setupNeeded(sql: Sql): Promise<boolean> {
  const [r] = await sql`SELECT count(*)::int AS n FROM orgs`;
  return r!.n === 0;
}

const SetupRequest = z.object({
  code: z.string().min(4).max(64),
  org: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
});

export function setupRoutes(sql: Sql, gate: SetupGate | null) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json({ needed: Boolean(gate && !gate.done) && (await setupNeeded(sql)) }));

  app.post("/", rateLimit(sql, "setup", 20, 15 * 60_000), async (c) => {
    if (!gate || gate.done) throw new HTTPException(409, { message: "This server is already set up. Sign in with your token." });
    const body = parseBody(SetupRequest, await c.req.json());
    gate.check(body.code);

    const created = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;
      const [r] = await tx`SELECT count(*)::int AS n FROM orgs`;
      if (r!.n > 0) throw new HTTPException(409, { message: "This server is already set up. Sign in with your token." });
      const out = await createOrgWithOwner(tx as unknown as Sql, { org: body.org, email: body.email, name: body.name, tokenName: "first-run setup" });
      await tx`INSERT INTO audit_log (org_id, user_id, action, target_id, meta)
               VALUES (${out.orgId}, ${out.userId}, 'org.setup', ${out.orgId}, ${tx.json({ via: "web first-run setup" })})`;
      return out;
    });
    gate.done = true;
    console.log(`First-run setup complete: org "${body.org}" (${created.orgId}), owner ${body.email}. The setup page is now disabled.`);
    return c.json({ token: created.token, org: { id: created.orgId, name: body.org, slug: created.slug } }, 201);
  });

  return app;
}

/** The banner the server prints at startup while setup is pending. */
export function setupBanner(code: string, publicUrl: string): string {
  const lines = [
    "First-run setup: no organization exists yet.",
    `Open ${publicUrl.replace(/\/$/, "")} and enter this one-time setup code:`,
    "",
    `    ${code}`,
    "",
    "It creates your organization and you as its owner. The code changes on every restart",
    "until setup is done. (Or set SETUP_CODE to choose it.)",
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "=".repeat(width);
  return [bar, ...lines.map((l) => `  ${l}`), bar].join("\n");
}
