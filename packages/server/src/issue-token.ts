/**
 * Server-side recovery: issue a new personal token for an existing member, e.g. when
 * the only owner lost theirs. Needs shell access to the server, so it is not an API route.
 *   node packages/server/dist/issue-token.js --email you@example.com [--org <slug>] [--name "recovery"]
 */
import { parseArgs } from "node:util";
import { newId } from "@session-relay/shared";
import { generateToken, hashToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

const { values } = parseArgs({ options: { email: { type: "string" }, org: { type: "string" }, name: { type: "string" } } });
if (!values.email) {
  console.error("Usage: issue-token --email you@example.com [--org <slug>] [--name <token name>]");
  process.exit(1);
}

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
try {
  const rows = await sql`
    SELECT m.org_id, m.user_id, m.role, o.slug, o.name AS org_name
    FROM memberships m JOIN users u ON u.id = m.user_id JOIN orgs o ON o.id = m.org_id
    WHERE u.email = ${values.email} ${values.org ? sql`AND o.slug = ${values.org}` : sql``}
  `;
  if (rows.length === 0) throw new Error(`No membership found for ${values.email}${values.org ? ` in ${values.org}` : ""}.`);
  if (rows.length > 1) throw new Error(`${values.email} is in several orgs (${rows.map((r) => r.slug).join(", ")}); pass --org <slug>.`);
  const m = rows[0]!;
  const token = generateToken();
  const id = newId("tok");
  await sql`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
            VALUES (${id}, ${m.org_id}, ${m.user_id}, ${hashToken(token)}, ${values.name ?? "recovery"})`;
  await sql`INSERT INTO audit_log (org_id, user_id, action, target_id, meta)
            VALUES (${m.org_id}, ${m.user_id}, 'token.issue_cli', ${id}, ${sql.json({ via: "server shell" })})`;
  console.log(`New token for ${values.email} (${m.role}) in ${m.org_name} (shown once):\n  ${token}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
