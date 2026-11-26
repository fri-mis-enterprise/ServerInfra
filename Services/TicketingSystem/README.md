# Ticketing System

One SvelteKit 3/Svelte 5 application on Bun 1.4.4, with Zod validation and Drizzle/SQLite. Native remote functions handle application workflows; authenticated server endpoints handle files and SSE realtime. Elysia, Eden and Prisma are removed.

## Run locally

```sh
cd Frontend
bun install --frozen-lockfile
cp .env.example .env
# Set JWT_SECRET, then:
bun run db:migrate
bun run db:seed
bun run dev
```

Open http://localhost:5173. Reference seeding is idempotent and does not create demo accounts. Create the first administrator using `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 12 characters):

```sh
export ADMIN_EMAIL=admin@example.com
read -rs -p 'Administrator password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
bun run admin:create
unset ADMIN_PASSWORD
```

`ADMIN_USERNAME` defaults to `admin`. Existing usernames/emails are rejected without changing their passwords or roles. Existing installations keep their accounts and JWT secret.

## Docker Compose

From the repository root, copy `.env.example` to `.env` and set `JWT_SECRET` and the browser origin `FRONTEND_URL`. Then:

```sh
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs -f web
```

The app listens on http://localhost:3001, bound to loopback. Use Caddy for LAN access. There is one `web` service, with persistent `sqlite_data` and `uploads` volumes. Startup verifies/adopts existing SQLite schemas and applies versioned Drizzle migrations before listening. It does not reset data or run seeds.

For a new installation, run `docker compose exec web bun run db:seed`. To create its first administrator, set/export the variables above on the host and run:

```sh
docker compose exec -e ADMIN_EMAIL -e ADMIN_PASSWORD web bun run admin:create
```

For optional web push, retain or generate a VAPID key pair:

```sh
docker compose exec web bun -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_CONTACT` in `.env`, then recreate `web`. Push requires HTTPS and browser permission. Supported push providers are FCM, Mozilla, Apple and Windows. Keys and subscription records survive the migration.

## Caddy at /ticketing/

Create the external `proxy` network if it does not already exist. Build/start using both Compose files:

```sh
docker compose -f docker-compose.yml -f compose.caddy.yml up -d --build --remove-orphans
```

Replace the previous ticketing handlers with [deploy/Caddyfile.ticketing](deploy/Caddyfile.ticketing), inside the existing `192.168.0.254` site block before the fallback handler:

```caddyfile
redir /ticketing /ticketing/ 308
handle /ticketing/* {
    reverse_proxy ticketing-web:3000
}
```

Remove the old `/ticketing/api/*` handler targeting `ticketing-backend`. Preserve the entire prefix with `handle`. The single server owns `/ticketing/_app/remote/*`, `/ticketing/api/*`, files, pages and the service worker. Validate/reload Caddy with your existing Caddy Compose setup.

The override builds with `VITE_BASE_PATH=/ticketing/` and `FRONTEND_URL=https://192.168.0.254`. If the hostname changes, update the override's build origin and Caddy site together. Remote-function CSRF checks require the actual browser origin, without a path. Rebuild after changing the base or origin.

## Upgrade an existing installation

Keep the same Compose project name, working directory and volume names so Compose reuses the existing database and uploads. Keep the existing JWT/VAPID secrets. Back up both volumes before the first single-service start; `down` must never use `-v`.

For the Caddy deployment, from the same repository directory as the previous deployment:

```sh
docker compose -f docker-compose.yml -f compose.caddy.yml build
docker compose -f docker-compose.yml -f compose.caddy.yml down --remove-orphans
mkdir -p backups
docker compose -f docker-compose.yml -f compose.caddy.yml run --rm --no-deps -v "$PWD/backups:/backup" --entrypoint sh web -c 'tar -czf /backup/sqlite.tar.gz -C /app/data . && tar -czf /backup/uploads.tar.gz -C /app/uploads .'
docker compose -f docker-compose.yml -f compose.caddy.yml up -d --remove-orphans
docker compose -f docker-compose.yml -f compose.caddy.yml logs --tail=100 web
```

Use a new backup directory for each upgrade. Apply the Caddy handler change above, validate/reload Caddy, then check login, a ticket, its original attachment and live messaging. The backup helper overrides startup, so it archives the stopped volumes before migrations run. For a local deployment, omit the second `-f compose.caddy.yml` throughout.

Existing schemas are checked against the baseline before migration history is recorded. Incompatible or partial schemas fail startup without recreating tables. For a rehearsal, restore the backups into separate volumes/project and verify there first. The repository's automated tests use disposable databases, not your production data.

To replace the database manually, stop `web`, back up both volumes, replace `/app/data/ticketing.db` in the SQLite volume and remove stale `ticketing.db-wal`/`ticketing.db-shm` only while all database writers are stopped. Restore the matching uploads too. Startup adopts a compatible old database. Do not use schema push or delete the volume.

## Files, realtime and validation

Uploads preserve original bytes and full-resolution downloads. JPEG/PNG/WebP uploads get a smaller WebP preview up to 480x480 when useful, with a 16-megapixel decode limit. Existing attachments work without a backfill. Uploads allow five files of at most 20 MB each; authenticated downloads enforce ticket access. Active document formats download with `nosniff` rather than execute inline.

Realtime uses authenticated SSE with automatic reconnect, fresh role/access checks and private internal-note channels. This deployment runs one Bun process; scaling to several independent instances requires a shared event broker. Notifications also retain polling recovery. The service worker caches static assets only; app/database operations require connectivity.

```sh
cd Frontend
bun run check
bun test
bun run build
bun run test:server
```

The integration check launches its own Bun server, database and upload directory. For browser checks, Chrome must be installed; build with a local origin first:

```sh
FRONTEND_URL=http://127.0.0.1:33001 VITE_BASE_PATH=/ticketing/ bun run build
bun run test:browser
```

See [migration notes](docs/sveltekit-migration.md) and [Linear tracking](https://linear.app/ibs-msap/project/sveltekit-consolidation-3e6a3b910b1f). Docker/live Caddy and real-provider web push must be verified on the deployment host.
