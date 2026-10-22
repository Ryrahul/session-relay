/**
 * First-run setup for a self-hosted install: creates the org, its owner and a
 * personal token. Run once:
 *   npm run bootstrap -w @session-relay/server -- --org "Acme" --email you@acme.dev --name "You"
 */
import { parseArgs } from "node:util";
import { newId } from "@session-relay/shared";
import { generateToken, hashToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    slug: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
  },
});
if (!values.org || !values.email || !values.name) {
  console.error('Usage: bootstrap --org "Team name" --email you@example.com --name "Your name" [--slug team]');
  process.exit(1);
}

const slug = values.slug ?? values.org.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
try {
  await migrate(sql);
  const orgId = newId("org");
  const userId = newId("usr");
  const token = generateToken();
  await sql.begin(async (tx) => {
    await tx`INSERT INTO orgs (id, name, slug) VALUES (${orgId}, ${values.org!}, ${slug})`;
    await tx`INSERT INTO org_settings (org_id) VALUES (${orgId})`;
    await tx`INSERT INTO users (id, email, name) VALUES (${userId}, ${values.email!}, ${values.name!})`;
    await tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${userId}, 'owner')`;
    await tx`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
             VALUES (${newId("tok")}, ${orgId}, ${userId}, ${hashToken(token)}, 'bootstrap')`;
  });
  console.log(`Created org "${values.org}" (${orgId}) with owner ${values.email}.`);
  console.log(`\nYour token (shown once, store it safely):\n  ${token}\n`);
  console.log(`Log in from your laptop:\n  relay login --server ${config.PUBLIC_URL} --token <token>`);
} finally {
  await sql.end();
}
