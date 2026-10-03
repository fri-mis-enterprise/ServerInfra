# SystemMonitor

Internal system monitoring and operations workspace. The Systems home page leads
to DCR access management at `/systemmonitor/dcr` and FAST station
period monitoring at `/systemmonitor/fast`. [PLAN.md](PLAN.md) defines DCR behavior;
[docs/runbook.md](docs/runbook.md) covers deployment and DBF operation.

FAST monthly-period access is available as a read-only inspection command:
`.venv/bin/python -m systemmonitor.fast --year 2026 --month 9`.
It reads direct station `DBASE/monthly.dbf` files under `/mnt/fast_system`
(override with `FAST_ROOT` or `--root`); use `--station FASTPA2` for one station.
See the runbook for status meanings and the reference programs.
The FAST dashboard scans only on demand through **Scan** or **Scan all
stations**. A popup shows progress while the worker checks stations. Saved
results retain their verification timestamps. Its worker does not scan
periodically or close periods automatically. Manual **Open** marks existing
records for one station and month as deleted; **Close** recalls those records.
It cannot generate missing monthly records. Controls are disabled by default.
To enable them, set `FAST_ENABLE_WRITES=true` and `FAST_VOLUME_MODE=rw` in
`.env`, and provide a writable host FAST mount. The web service never mounts
the FAST share. An interrupted change stays in recovery until an operator
chooses **Resume and verify**. Saved DBF/CDX backups remain under
`MONITOR_DATA/fast-actions/` for audit and recovery.
On this host, run `python3 scripts/mount_fast_rw.py` after a reboot, then
`docker compose up -d --force-recreate fast-worker`; the separate FAST mount
is not in `/etc/fstab`.

The interface lives in `frontend/` and uses SvelteKit with Svelte components and routes. Python Flask owns the JSON API, session authentication, audit records, and DBF access. The independent Python worker owns polling and scheduled closures. SvelteKit builds a static browser application; Flask serves its compiled files and the API on the same origin. No Node/Bun process is required at runtime.

Use **Bun 1.4.2** (the installed 1.4 release): `cd frontend`, `bun install --frozen-lockfile`, `bun run check`, and `bun run build`. The lockfile is committed, and Docker pins `oven/bun:1.4.2` for the frontend build. The public base path defaults to `/systemmonitor`; a custom path must match both the frontend build's `BASE_PATH` and Python's `BASE_PATH`.

For local development, install `requirements-dev.txt`, then start Python with `FRONTEND_BUILD=frontend/build waitress-serve --listen=127.0.0.1:3030 --call systemmonitor.web:create_app`. In `frontend/`, run `bun run dev`; Vite proxies `/systemmonitor/api` to Python on port 3030. Run the worker separately with `python -m systemmonitor.worker`. Use temporary data and `ENABLE_WRITES=false` when developing against the real share. Validate Python with `python -m pytest -q`.

For deployment, run `docker compose up -d --build`. Its multi-stage build compiles SvelteKit using Bun, then copies only the built interface into the Python image. Existing SQLite data, accounts, invitations, schedules, and cookies are retained.

The server uses the Python `dbf` package to change `ALLOW` when `ENABLE_WRITES=true`. Set it to `false` to run without DBF mutations. The writer serializes dashboard and worker operations but does not take locks used by external FoxPro clients.

This directory is part of the shared ServerInfra repository. Commit the application
source, tests, deployment files, documentation, and `.env.example`; the local
`.gitignore` excludes real secrets, runtime data, DBF copies, caches, and generated
files. Application source is needed because Docker Compose builds the image locally.

Use the Login and Register pages for personal accounts. The existing `mis` login
keeps its password during migration. Audit trail records dashboard usernames,
opening/closing timestamps, and detected **(Direct DCR Change)** events.

Registration requires a single-use invitation created by `mis` from **Invitations**. Links expire after 48 hours and can be revoked before use. Share the generated link directly; raw invitation tokens are displayed only at creation and stored as SHA-256 hashes. New passwords require at least 4 characters. Existing accounts and passwords are retained.
