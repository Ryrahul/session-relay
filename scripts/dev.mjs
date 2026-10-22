#!/usr/bin/env node
// Local development: Postgres in Docker, API server with reload, web app with Vite.
//   npm run dev:all
// First run, in another terminal: npm run bootstrap:dev -- --org "Dev" --email you@example.com --name "You"
import { spawn, spawnSync } from "node:child_process";

const PG = "relay-dev-pg";
const DATABASE_URL = "postgres://relay:relay@localhost:54320/relay";

const running = spawnSync("docker", ["ps", "-q", "-f", `name=^${PG}$`], { encoding: "utf8" }).stdout.trim();
if (!running) {
  const exists = spawnSync("docker", ["ps", "-aq", "-f", `name=^${PG}$`], { encoding: "utf8" }).stdout.trim();
  const args = exists
    ? ["start", PG]
    : ["run", "-d", "--name", PG, "-e", "POSTGRES_USER=relay", "-e", "POSTGRES_PASSWORD=relay", "-e", "POSTGRES_DB=relay",
       "-p", "54320:5432", "-v", "relay-dev-pgdata:/var/lib/postgresql/data", "postgres:16-alpine"];
  if (spawnSync("docker", args, { stdio: "inherit" }).status !== 0) process.exit(1);
  for (let i = 0; i < 30; i++) {
    if (spawnSync("docker", ["exec", PG, "pg_isready", "-U", "relay"]).status === 0) break;
    spawnSync("sleep", ["1"]);
  }
}

spawnSync("npm", ["run", "build", "-w", "@session-relay/shared"], { stdio: "inherit" });
const env = { ...process.env, DATABASE_URL, PORT: "8787", PUBLIC_URL: "http://localhost:5173", STORAGE_LOCAL_DIR: ".relay-dev/transcripts" };
const procs = [
  spawn("npm", ["run", "dev", "-w", "@session-relay/server"], { stdio: "inherit", env }),
  spawn("npm", ["run", "dev", "-w", "@session-relay/web"], { stdio: "inherit", env }),
];
console.log("\nAPI http://localhost:8787  ·  Web http://localhost:5173  ·  Postgres " + DATABASE_URL + "\n");
const stop = () => procs.forEach((p) => p.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
