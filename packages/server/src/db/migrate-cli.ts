import { loadConfig } from "../config.js";
import { createDb } from "./client.js";
import { migrate } from "./migrate.js";

const sql = createDb(loadConfig().DATABASE_URL);
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await sql.end();
}
