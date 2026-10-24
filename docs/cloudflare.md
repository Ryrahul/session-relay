# Deploy to Cloudflare

Run Session Relay on **Cloudflare Workers**, with no server to maintain. It's the same app as the [Docker version](self-hosting.md), with the same features, CLI and web app. Pick whichever suits you:

| | Docker (self-hosting.md) | Cloudflare (this guide) |
|---|---|---|
| You run | A Linux server with Docker | Nothing. Cloudflare runs the Worker |
| Database | Postgres in Docker | Any Postgres (Neon, Supabase, RDS…) through **Hyperdrive** |
| Full transcripts | Docker volume | **R2** bucket |
| Web app | Served by the server | **Workers Static Assets** |
| Expiry cleanup | Hourly timer | **Cron Trigger** |
| First-run setup code | Printed in the server logs | A secret you set (`SETUP_CODE`) |
| Migrations | Run on startup | You run them before each deploy (one command) |

## What you need

- A **Cloudflare account**. The free plan is enough for a small team; Workers Paid ($5/month) raises the request and CPU limits. Check Cloudflare's current pricing for Hyperdrive, R2 and Cron limits.
- A **Postgres 14+** database reachable from the internet, e.g. a free [Neon](https://neon.tech) project. Copy its connection string (`postgres://user:password@host/db?sslmode=require`).
- **Node.js 20+** and git on your laptop.
- For your own domain: the domain's DNS must be on Cloudflare. Without one, the Worker gets a free `session-relay.<you>.workers.dev` address.

## 1. Get the code and build

```sh
git clone https://github.com/Ryrahul/session-relay.git
cd session-relay
npm ci && npm run build
npx wrangler login                    # opens the browser
```

## 2. Create the database tables

```sh
DATABASE_URL="postgres://user:password@host/db?sslmode=require" \
  node packages/server/dist/db/migrate-cli.js
```

## 3. Create Hyperdrive and R2

```sh
cd packages/server
npx wrangler hyperdrive create session-relay --connection-string="postgres://user:password@host/db?sslmode=require"
npx wrangler r2 bucket create session-relay-transcripts
```

## 4. Configure

Edit `packages/server/wrangler.jsonc`:

- `hyperdrive[0].id`: the id printed by `hyperdrive create`
- `vars.PUBLIC_URL`: the address people will use, e.g. `https://relay.your-team.com` (or your `workers.dev` address)
- For a custom domain, add:

  ```jsonc
  "routes": [{ "pattern": "relay.your-team.com", "custom_domain": true }]
  ```

Then choose a first-run setup code and store it as a secret:

```sh
npx wrangler secret put SETUP_CODE          # e.g. type: KDQX-7MRA-4ZTP
```

## 5. Deploy

```sh
npx wrangler deploy
```

Open your URL. It shows **Set up Session Relay**. Enter the setup code, your organization's name, and your name and email. You become the owner; your token is shown once.

Setup closes for good once an organization exists, but remove the secret anyway:

```sh
npx wrangler secret delete SETUP_CODE
```

Then invite your team from **Members → Invite with a link**, and everyone follows [Getting started](getting-started.md).

## Updating

```sh
git pull && npm ci && npm run build
DATABASE_URL="…" node packages/server/dist/db/migrate-cli.js     # migrations first
cd packages/server && npx wrangler deploy
```

Migrations are additive, so the running version keeps working while they apply. To undo a bad deploy: `npx wrangler rollback`.

## Backups

- **Database:** use your provider's backups (Neon keeps point-in-time history), or `pg_dump "$DATABASE_URL" | gzip > relay-$(date +%F).sql.gz`.
- **Transcripts:** R2 is durable. To keep a copy elsewhere, use `rclone` with R2's S3-compatible API.

## Moving from Docker to Cloudflare

1. On the Docker server, take a database backup:
   ```sh
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres pg_dump -U relay -d relay | gzip > relay.sql.gz
   ```
2. Restore it into the new Postgres. Skip step 2 of this guide; the dump already has the tables.
   ```sh
   gunzip -c relay.sql.gz | psql "$DATABASE_URL"
   ```
3. Copy full transcripts from the `transcripts` volume into R2:
   ```sh
   scripts/copy-transcripts-to-r2.sh /var/lib/docker/volumes/<project>_transcripts/_data session-relay-transcripts
   ```
4. Deploy (steps 3–5, without `SETUP_CODE`: your organization already exists).
5. Point your domain at the Worker. Everyone keeps their tokens. If the address changes, they run `relay login --server <new url>` once.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `500` on every API call | `npx wrangler tail` shows the error. Most often the Hyperdrive id is wrong or the database is unreachable |
| The setup page doesn't appear on a new install | `SETUP_CODE` isn't set; run `npx wrangler secret put SETUP_CODE` and reload |
| `relation "…" does not exist` | Migrations didn't run against this database (step 2) |
| Custom domain doesn't work | The domain's DNS has to be on Cloudflare; until then use the `workers.dev` address |
| `429 Too many requests` | Public endpoints (invites, browser login, setup) are rate-limited per IP; wait a minute |
