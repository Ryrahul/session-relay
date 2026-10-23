# Branches and deployment

## Branches

```
feature/xyz ──PR──▶ main ──PR (scripts/release.sh)──▶ deploy ──▶ production
```

| Branch | Purpose | What runs |
|---|---|---|
| `feature/*`, `fix/*` | Day-to-day work | CI on the PR |
| `main` | Integrated, always releasable | CI on every push |
| `deploy` | What is live. Never commit to it directly | **Deploy** workflow on every push |

To release: `scripts/release.sh` opens a PR from `main` to `deploy` listing the commits. Merging it deploys.

The Deploy workflow:

1. Runs the full CI (build, unit tests, Postgres integration tests).
2. Builds the image and pushes it to `ghcr.io/<owner>/session-relay:<commit>` (and `:deploy`).
3. **Rehearses** the release: starts a throwaway server on the runner, reachable over SSH, and deploys the same image with the same scripts. It then:
   - bootstraps an org and checks the API, auth and web app,
   - redeploys and checks that a backup was taken and the data kept,
   - tries to deploy a tag that doesn't exist and checks the live version kept running.

   Production is only touched if the rehearsal passes.
4. Copies `docker-compose.prod.yml`, `Caddyfile` and `deploy-remote.sh` to the server over SSH.
5. On the server, `deploy-remote.sh`:
   - backs up the database to `backups/` (keeps 14),
   - starts the new image,
   - checks `/health` for up to 90 s,
   - if healthy, marks it live (`.current_tag`, image tagged `:current`);
   - if not, prints the logs and rolls back to the previous version automatically, and the run fails.

Only one deploy runs at a time.

## First deploy is automatic

Before every deploy, `deploy/server-setup.sh` runs on the server. If there's no `.env` yet, it creates one:
- a random database password,
- `PUBLIC_URL` and `DOMAIN`: for a bare IP like `20.168.9.177` that's `relay.20-168-9-177.sslip.io`, so HTTPS works without owning a domain,
- Caddy for HTTPS **only if ports 80 and 443 are free**. Otherwise the API listens on `127.0.0.1:<port>` for your existing proxy.

It never overwrites an existing `.env`. To use your own domain later, edit `DOMAIN` and `PUBLIC_URL` in the server's `.env` and redeploy.

The server only needs Docker, and the deploy user must be allowed to run it (`sudo usermod -aG docker <user>`). The setup script stops with a clear message if either is missing.

## One-time server setup (manual alternative)

On the server (Ubuntu/Debian):

```sh
curl -fsSL https://get.docker.com | sh
sudo useradd -m -s /bin/bash deploy && sudo usermod -aG docker deploy
sudo mkdir -p /opt/session-relay && sudo chown deploy:deploy /opt/session-relay
```

Create `/opt/session-relay/.env` from [`deploy/.env.example`](../deploy/.env.example):

```sh
POSTGRES_PASSWORD=<openssl rand -base64 32>
PUBLIC_URL=https://relay.yourdomain.com
DOMAIN=relay.yourdomain.com
COMPOSE_PROFILES=tls        # empty if you already run nginx; point it at 127.0.0.1:8787
SERVER_PORT=8787
```

Then:
- Point the domain's DNS A record at the server.
- Open ports 80 and 443. The API itself only listens on 127.0.0.1.

## GitHub secrets

Settings → Secrets and variables → Actions, or with `gh`:

```sh
ssh-keygen -t ed25519 -f relay_deploy -N "" -C "github-deploy"     # add relay_deploy.pub to ~deploy/.ssh/authorized_keys
gh secret set DEPLOY_HOST --body "203.0.113.10"
gh secret set DEPLOY_USER --body "deploy"
gh secret set DEPLOY_SSH_KEY < relay_deploy
gh secret set DEPLOY_KNOWN_HOSTS --body "$(ssh-keyscan 203.0.113.10)"   # recommended
# optional: DEPLOY_PATH (default /opt/session-relay), DEPLOY_PORT (default 22)
```

Until these exist, the Deploy workflow still builds and pushes the image and then stops with a warning.

## First deploy

1. Merge to `deploy` (or run the Deploy workflow by hand from the Actions tab).
2. Create the org and your owner token, once:

   ```sh
   ssh deploy@server
   cd /opt/session-relay
   docker compose exec server node packages/server/dist/bootstrap.js --org "Your Team" --email you@example.com --name "You"
   ```
3. On your laptop: `relay login --server https://relay.yourdomain.com --token srk_...`, then `relay invite` your teammates.

## Rollback and restore

- **Automatic:** a deploy that fails its health check rolls back by itself.
- **Back to an earlier build:** Actions → Deploy → Run workflow, and enter the tag (the 12-character commit SHA, see `.previous_tag` on the server).
- **On the server directly:**
  ```sh
  cd /opt/session-relay
  IMAGE=ghcr.io/<owner>/session-relay bash deploy-remote.sh "$(cat .previous_tag)"
  ```
- **Restore the database from a backup:**
  ```sh
  docker compose stop server
  docker compose exec -T postgres dropdb -U relay relay
  docker compose exec -T postgres createdb -U relay relay
  gunzip -c backups/<file>.sql.gz | docker compose exec -T postgres psql -q -U relay -d relay
  docker compose start server
  ```

Migrations run when the server starts, and rollback does not undo them. Keep migrations backward compatible (add columns and tables; don't rename or drop in the same release that stops using them). If a schema change can't be, restore the backup taken before that deploy.

## Tested locally

`deploy-remote.sh` was run against a simulated server, with this sequence:

1. Deploy a working image.
2. Create data.
3. Deploy a second version.
4. Deploy a broken image.

Results:
- Backups were taken before every deploy.
- The broken image failed its health check and was rolled back automatically.
- The data survived all deploys.
- A backup restored into a fresh database.

The GitHub workflows pass `actionlint`; the shell scripts pass `shellcheck`.
