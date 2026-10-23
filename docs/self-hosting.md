# Self-hosting

Run Session Relay for your team on any machine with Docker. It's one container for the API and web app, plus Postgres. Caddy can provide HTTPS with automatic certificates.

> **Cloud hosting is coming soon.** We'll run it for you, so you don't need a server. Until then, self-hosting is the way to use Session Relay.

## Requirements

- A Linux server (or any machine) with Docker and Docker Compose v2. 1 vCPU and 1 GB RAM is plenty for a team of 20.
- A domain or subdomain pointing at it, e.g. `relay.your-team.com`, if you want HTTPS (you do).
- Ports 80 and 443 open if you use the built-in Caddy.

Storage: a typical share (summary plus the last 30 messages) is 50–150 KB. A team of 10 sharing a few sessions a day uses well under 1 GB a year at the default 90-day retention.

## 1. Get the code

```sh
git clone https://github.com/Ryrahul/session-relay.git
cd session-relay
```

## 2. Configure

```sh
cp deploy/.env.example deploy/.env
```

Edit `deploy/.env`:

```sh
POSTGRES_PASSWORD=<output of: openssl rand -base64 32>
PUBLIC_URL=https://relay.your-team.com
DOMAIN=relay.your-team.com
COMPOSE_PROFILES=tls
SERVER_PORT=8787
```

- With `COMPOSE_PROFILES=tls`, Caddy listens on ports 80 and 443 and gets a certificate for `DOMAIN` automatically.
- **Already running nginx or Traefik?** Set `COMPOSE_PROFILES=` (empty) and proxy your domain to `http://127.0.0.1:8787`. A minimal nginx block:

  ```nginx
  server {
    server_name relay.your-team.com;
    client_max_body_size 25m;
    location / { proxy_pass http://127.0.0.1:8787; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
  }
  ```

## 3. Start

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
curl -s http://127.0.0.1:8787/health      # {"ok":true}
```

Database migrations run automatically when the server starts.

## 4. Create your organization (first-run setup)

On a fresh server, the server prints a **one-time setup code** in its logs:

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs server | grep -A2 "setup code"
```

```
  Open https://relay.your-team.com and enter this one-time setup code:
      GZUB-5QPU-TTLS
```

Open `PUBLIC_URL` in a browser. It shows **Set up Session Relay**. Enter the code, your organization's name, and your name and email. You become the **owner**, and your owner token is shown **once**. Save it in your password manager. You're signed in straight away.

How it stays safe:
- The setup page only exists while the server has no organization. After that it's gone for good.
- Without the code from the server logs, nobody else can claim a new server.
- 10 wrong codes lock setup for 15 minutes.
- The code changes on every restart, until setup is done. To choose it yourself, set `SETUP_CODE`.

<details><summary>Prefer the command line?</summary>

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec server \
  node packages/server/dist/bootstrap.js --org "Your Team" --email you@your-team.com --name "Your Name"
```

It prints the owner token once.
</details>

Then:

- **Members → Add a teammate** for each person. Each gets a one-time `relay login ...` command to send them privately.
- **Settings:** set retention, and optionally an allowlist of repositories (`github.com/your-org/*`) and extra secret patterns.

Everyone then follows [Getting started](getting-started.md).

## Upgrading

```sh
cd session-relay
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Back up first (below). Migrations run on start.

## Backups

All data is in Postgres. Full transcripts are in the `transcripts` volume.

```sh
# back up
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres \
  pg_dump -U relay -d relay | gzip > relay-$(date +%F).sql.gz

# restore into a fresh database
docker compose -f deploy/docker-compose.yml --env-file deploy/.env stop server
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres dropdb -U relay relay
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres createdb -U relay relay
gunzip -c relay-2026-10-23.sql.gz | docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres psql -q -U relay -d relay
docker compose -f deploy/docker-compose.yml --env-file deploy/.env start server
```

Run the backup from cron, e.g. nightly, and copy the files somewhere off the server.

## Configuration reference

| Variable | Default | |
|---|---|---|
| `POSTGRES_PASSWORD` | (required) | Database password |
| `PUBLIC_URL` | `http://localhost:8787` | Address people use; shown in login commands |
| `DOMAIN` | | Domain for Caddy's HTTPS certificate |
| `COMPOSE_PROFILES` | | `tls` to run Caddy |
| `SERVER_PORT` | `8787` | Host port of the API |
| `SERVER_BIND` | `127.0.0.1` | Host interface the API port binds to |
| `SETUP_CODE` | (random) | Fixed first-run setup code, instead of the one printed at startup |
| `STORAGE_DRIVER` | `local` | Where full transcripts go. `local` = Docker volume. S3/R2 is planned |

Org settings (retention, allowed repositories, secret patterns) are changed in the web app under **Settings**, not in env vars.

## Running without Docker

You need Node.js 20+ and Postgres 14+.

```sh
npm ci && npm run build
DATABASE_URL=postgres://user:pass@host:5432/relay \
PUBLIC_URL=https://relay.your-team.com \
WEB_DIST=$PWD/packages/web/dist \
STORAGE_LOCAL_DIR=/var/lib/session-relay/transcripts \
node packages/server/dist/index.js
```

Create the first org with `node packages/server/dist/bootstrap.js ...` using the same env vars.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `relay login` says it can't reach the server | Check `PUBLIC_URL` and DNS. Try `curl https://relay.your-team.com/health` from the laptop |
| Caddy can't get a certificate | DNS must point at the server and ports 80/443 must be open. Check `docker compose ... logs caddy` |
| `Repo ... is not on this org's allowlist` | Add it under **Settings → Allowed repositories**, or clear the list |
| `413 Request too large` when sharing a full transcript | Shares are capped at 25 MB. Share `summary+tail` instead, or raise `client_max_body_size` in your proxy |
| Lost a token, or the only owner is locked out | On the server: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec server node packages/server/dist/issue-token.js --email you@your-team.com`. It prints a new token |
