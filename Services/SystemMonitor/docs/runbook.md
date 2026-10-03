# SystemMonitor operations

The web process reads SQLite observations. The worker reads the eight configured `lockmonth.dbf` files every 30 seconds and records detected access and closure attempts. DCR_LBASD, DCR_MNVP, DCR_Sygnal, and DCR_Synegia are excluded. The SQLite directory must stay on this server's local disk. The app uses the Python `dbf` package for DBF writes when enabled. Timestamps are stored in UTC and displayed using Asia/Manila.

## Read-only startup

1. Copy `.env.example` to `.env`, set a strong `ADMIN_PASSWORD` and `SECRET_KEY`, and restrict the file to the service operator. Set `ENABLE_WRITES=false` to disable DBF changes or `true` to enable dashboard openings and scheduled closures.
2. Ensure the host `data` directory is writable by UID 1000 and the service account can write the System3 share. This Compose configuration uses the local `/mnt/system3` share and the existing external `proxy` network.
3. Run `docker compose up -d --build`. Check `docker compose ps`, then `docker compose logs worker` and `docker compose logs web`.
4. Add `deploy/Caddyfile.fragment` inside the site's Caddy block before the fallback `handle`, adapt the upstream name if Compose created a different name, then validate and reload Caddy.
5. Browse `/systemmonitor/` with HTTP Basic authentication (`mis` and `ADMIN_PASSWORD`). The Refresh health panel must show eight successful reads. Refresh errors and old observations are visible even when the web process stays healthy.

The header's system clock shows server time in Asia/Manila, which is also used
for deadlines. It advances every second and refreshes from `/systemmonitor/time`
every minute. If the time endpoint is unavailable, the header shows a warning
and continues from its last sample. This display does not set the host clock;
check host synchronization with `timedatectl status` if times differ.

The worker may initially show many externally opened months. An unscheduled previous-month opening is normal through the end of the 3rd in Manila. A detected exception gets a fixed next-midnight deadline. With writes enabled, due closures are applied by the Python DBF writer.

## Recovery and inspection

The `data/monitor.sqlite3` database contains schedules, observations, events, and request identifiers. Back it up as an SQLite database while the processes run, or stop both processes and copy the SQLite file along with its WAL files. Never place it on the System3 share. A worker restart processes overdue schedules on its next tick. A failed closure stays listed and is retried. An early DCR closure removes the entry from the active list and remains in history. The status endpoint `/systemmonitor/status` returns the HTMX fragment for a manual read check.

Removing an application from the configured list retires its pending, active, and failed schedules with an `excluded` event on the next worker cycle. Its old observations and events remain in SQLite, but it disappears from the dashboard and is no longer read or closed by the worker.

The application keeps both processes separate to prevent a web request from performing a background poll. Stop the worker to pause monitoring; stopping only the web process does not pause the worker.

## Python DBF writer

`systemmonitor/dbf_writer.py` opens the selected table with the Python `dbf` package, checks the schema and unique year/month and RECID, compares the current ALLOW value with the expected value, changes ALLOW, and verifies the non-ALLOW fields and resulting row. The DBF package does not coordinate writes with FoxPro record locks and does not update persistent CDX indexes. A local copy of DCR_Main's complete DBF/CDX/DBC companions was opened and closed with ALLOW changed; all other parsed fields remained unchanged, the CDX hash remained unchanged, and the copied files were restored. Verify the current table's CDX tags and behavior in a DCR test application after any data-layout change.

The service serializes its own worker and dashboard updates using a local SQLite operation lock. It does not serialize with other FoxPro clients. Set `ENABLE_WRITES=false` to disable DBF mutations. The writer only accepts configured application paths and checks record identity and expected ALLOW before each update.
