import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { purgeExpired } from "./routes/sessions.js";
import { createStorage } from "./storage/index.js";

const PURGE_EVERY_MS = 60 * 60 * 1000;

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
const applied = await migrate(sql);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);

const storage = createStorage(config);
const app = createApp({ sql, storage, webDist: config.WEB_DIST });

const purge = () =>
  purgeExpired(sql, storage)
    .then((n) => n && console.log(`Purged ${n} expired session(s)`))
    .catch((err) => console.error("Purge failed:", err));
void purge();
setInterval(purge, PURGE_EVERY_MS).unref();

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`session-relay server listening on :${info.port}`);
});
