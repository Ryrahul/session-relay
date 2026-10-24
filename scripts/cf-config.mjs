// Fills packages/server/wrangler.jsonc for a deploy (used by the Deploy workflow).
//   HYPERDRIVE_ID=… PUBLIC_URL=https://… [CUSTOM_DOMAIN=relay.example.com] node scripts/cf-config.mjs [file]
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? new URL("../packages/server/wrangler.jsonc", import.meta.url).pathname;
const { HYPERDRIVE_ID, PUBLIC_URL, CUSTOM_DOMAIN } = process.env;
if (!HYPERDRIVE_ID || !PUBLIC_URL) {
  console.error("Set HYPERDRIVE_ID and PUBLIC_URL");
  process.exit(1);
}
let s = readFileSync(file, "utf8")
  .replace("REPLACE_ME_HYPERDRIVE_ID", HYPERDRIVE_ID)
  .replace("https://REPLACE_ME.example.com", PUBLIC_URL.replace(/\/$/, ""));
if (CUSTOM_DOMAIN) {
  s = s.replace(`"name": "session-relay",`, `"name": "session-relay",\n  "routes": [{ "pattern": ${JSON.stringify(CUSTOM_DOMAIN)}, "custom_domain": true }],`);
}
if (s.includes("REPLACE_ME_HYPERDRIVE_ID") || s.includes("REPLACE_ME.example.com")) {
  console.error("wrangler.jsonc still has REPLACE_ME placeholders");
  process.exit(1);
}
writeFileSync(file, s);
console.log(`wrangler.jsonc ready: hyperdrive ${HYPERDRIVE_ID}, ${PUBLIC_URL}${CUSTOM_DOMAIN ? `, custom domain ${CUSTOM_DOMAIN}` : ""}`);
