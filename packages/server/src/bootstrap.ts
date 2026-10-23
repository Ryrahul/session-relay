/**
 * Create an org with an owner from the server shell. Usually you don't need this:
 * open the web app on a fresh server and use first-run setup instead.
 *   node packages/server/dist/bootstrap.js --org "Acme" --email you@acme.dev --name "You"
 */
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { createDb, type Sql } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { createOrgWithOwner } from "./orgs.js";

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

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
try {
  await migrate(sql);
  const created = await sql.begin((tx) =>
    createOrgWithOwner(tx as unknown as Sql, { org: values.org!, slug: values.slug, email: values.email!, name: values.name!, tokenName: "bootstrap" }),
  );
  console.log(`Created org "${values.org}" (${created.orgId}) with owner ${values.email}.`);
  console.log(`\nYour token (shown once, store it safely):\n  ${created.token}\n`);
  console.log(`Log in from your laptop:\n  relay login --server ${config.PUBLIC_URL} --token <token>`);
} finally {
  await sql.end();
}
