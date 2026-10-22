import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { createStorage } from "./storage/index.js";

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
const applied = await migrate(sql);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);

const app = createApp({ sql, storage: createStorage(config) });
serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`session-relay server listening on :${info.port}`);
});
