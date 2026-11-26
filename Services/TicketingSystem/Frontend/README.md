# SvelteKit app

Bun 1.4.4, SvelteKit 3, Svelte 5, Zod and Drizzle/SQLite. This directory contains both the interface and server. The [root README](../README.md) covers Compose, Caddy, upgrades, backups and first-admin creation.

```sh
bun install --frozen-lockfile
cp .env.example .env
# Set JWT_SECRET and confirm DATABASE_URL/FRONTEND_URL.
bun run db:migrate
bun run db:seed
bun run dev
```

`DATABASE_URL` is a local SQLite `file:` URL. `UPLOAD_DIR` defaults to `./uploads`. The development origin is http://localhost:5173. Native remote functions handle app reads and writes; `/api/attachments`, `/uploads/[filename]` and `/api/events` handle multipart files, authenticated downloads and SSE.

```sh
bun run check
bun test
bun run build
bun run test:server
bun run start
```

The Vite commands run explicitly under Bun because the server uses `bun:sqlite`. Production output is `build/`; startup runs the guarded migration before the server. `PORT` defaults to the adapter's port; Compose sets 3000. Set `FRONTEND_URL` to the browser origin and `VITE_BASE_PATH=/ticketing/` when building behind the Caddy subpath.

`bun run db:seed` inserts missing reference data without changing existing entries or creating users. `bun run admin:create` requires `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters); optional `ADMIN_USERNAME` defaults to admin. It refuses existing accounts.

`bun run db:generate` creates future Drizzle migrations for review. Never use schema push against deployed data. Existing databases are adopted after exact schema compatibility checks; stored rows and legacy migration history stay intact.

`bun run test:server` launches an isolated compiled Bun server and disposable SQLite/uploads. `bun run test:browser` additionally requires Chrome and a build with a local HTTP `FRONTEND_URL` (for example http://127.0.0.1:33001). It refuses external origins and creates its own server and fixtures.

The UI keeps browser-only editors/stores client-rendered. Pages use native SvelteKit routing; the small router adapter supports existing component call sites. Static assets use the native service worker; live data is never cached offline. Realtime runs in one Bun process.
