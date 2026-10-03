# SystemMonitor operations

## FAST periods

The host mount `/mnt/fast_system` points to `//192.168.0.234/fast_system`.
Check its effective mount options with
`findmnt -T /mnt/fast_system -o TARGET,SOURCE,FSTYPE,OPTIONS`.
Run `.venv/bin/python -m systemmonitor.fast --year 2026 --month 9`
on the host, or add `--station FASTPA2` to inspect one station. Each output
line is a JSON station summary. `FAST_ROOT` or `--root` can override the root.
The command always opens tables with `dbf.READ_ONLY`, independently of
the DCR `ENABLE_WRITES` setting.

The FAST dashboard at `/systemmonitor/fast` reads saved station summaries
from SQLite through the authenticated `/systemmonitor/api/fast/status` API.
The optional `period=YYYY-MM` query selects a period; the default is the previous
month in Manila. Changing periods and refreshing the view never read the share.
Saved observations do not expire with age; every station shows its last verified
timestamp. Failed reads show as unverified, with previous counts retained.

Compose starts a separate `fast-worker` that mounts `${FAST_ROOT:-/mnt/fast_system}`
at `/fast-source` (read-only by default). The web and DCR worker do not mount FAST. This
worker waits for manual requests in local SQLite. It never scans on a timer or
on startup. Click **Scan all stations** for initial discovery or a full check;
click **Scan** on a known station card. The popup shows processed and failed
station counts while the scan runs. Each scan reads all periods for the
requested station(s) and saves each successful result immediately. A station
scan does not enumerate or read other stations. **Refresh view** and changing
the selected period only read SQLite. The browser polls saved progress while a
scan is queued or running, then stops polling when the request finishes.

The authenticated, CSRF-protected `POST /systemmonitor/api/fast/scan` queues
`{"station": "fastsyg"}` for one known station or `{"station": null}` for all.
Requests are durable, record the requesting username, and run one at a time.
Repeated requests for the same active scope coalesce; a different scope receives
HTTP 409 while another scan is active. A local file lock prevents overlapping
FAST workers. An idle worker checks SQLite only and never accesses the FAST
share. Network delays in FAST cannot block DCR polling or closures.

Queued requests survive restart. A scan that was running when its worker stopped
is marked interrupted on restart; it is not automatically rerun. Request another
scan to retry. A failed station scan leaves other station results unchanged;
a failed full discovery marks all known stations unverified. Removed known station
tables remain listed with an error after a full scan. `FAST_POLL_SECONDS` is no
longer used and can be removed from existing `.env` files. There is no automatic
FAST closing schedule; the usual 3rd at 9 AM is an operational convention only.

Run `python -m systemmonitor.fast_worker --once` for an explicit host-side all-station
scan, or add `--station fastsyg` for one station. These commands take the same
worker lock; stop the running FAST worker before using them against its data
directory. Use temporary `MONITOR_DATA` when testing against the real share.
Opening and closing controls are disabled until `FAST_ENABLE_WRITES=true` and
`FAST_VOLUME_MODE=rw` are set in `.env` and the host FAST source is writable.
The deployed FAST worker uses the separate mount at
`/home/mis/.local/share/systemmonitor-fast-rw`; `.env` points `FAST_ROOT`
there. `scripts/mount_fast_rw.py` mounts it using the host's existing CIFS
account, verifies a temporary write on inactive `fastsyg`, then deletes its
temporary credentials file. This account has passwordless sudo permission for
`mount` and `umount`, but not for editing `/etc/fstab`, so the separate mount
does not return automatically after a host reboot. Run
`python3 scripts/mount_fast_rw.py` after a reboot, then
`docker compose up -d --force-recreate fast-worker` so the container gets the
restored bind mount. Do this even if Docker auto-started the worker earlier.
`ENABLE_WRITES` governs DCR separately.

With controls enabled, **Open** deletes existing records for exactly the
selected station and month; **Close** recalls those records. No missing records
are generated. The worker validates the DBF layout, the first-day dates, and
all structural CDX tags before changing one-byte deletion markers. It refuses
filtered or unknown index expressions. Backups and a checksum manifest are
saved under `MONITOR_DATA/fast-actions/<request-id>/` before any DBF write.
After a complete readback, the worker atomically updates the station cache and
operation history in SQLite. An interruption remains **needs recovery** after
restart. Use **Resume and verify** for that same operation; the worker verifies
every unrelated DBF byte and the CDX checksum before continuing. If another
process changed those files, recovery stops for manual review. Only one FAST
operation or scan is active at a time. Keep the saved backups for recovery.

Only immediate station `dbase/monthly.dbf` tables are discovered, with
case-insensitive filename matching. Nested backups and `NON-WORKING`
stations are not scanned. `fastmnv` is inspected but marked
`generation_excluded`, matching the generation reference's exclusion.

`closed_records_present` means active records exist on the month's first
day, matching the generation program's `LOCATE` test. It does not verify
complete account coverage or ledger totals. `open_deleted` means the
period's records are all flagged deleted; `missing` means no records
exist for the period. `mixed` reports both active and deleted records,
and `unexpected_dates` reports active records without a first-day record.
Counts retain both deletion states; deleted records must not be silently
filtered out. A detected file change during inspection produces an error.

The three files in `PRG REFERENCES` perform different operations:

- `opening-period-specific-station.prg`: flags the selected station's
  monthly records deleted for the selected month.
- `close-period.prg`: recalls existing records from January 2024 through
  the selected month across stations; it cannot generate missing records.
- `close fast - no fastdb dependency.prg`: checks for an active first-day
  record and, when absent, generates account summaries from `apledger.dbf`
  and `chracct.dbf`, excluding `fastmnv`.

Generation is not implemented. Any future generation must
account for the observed `NBEGAMT` field, which the reference cursor omits,
and distinguish recalled records from missing summaries.

### Local interruption rehearsal

Run `.venv/bin/python -m systemmonitor.fast_trial` to replay FASTPA2's
September 2026 closing records in disposable tables under `/tmp`.
Use `--source`, `--year`, and `--month` to choose another already closed
reference period. The source is opened only for reading. The trial keeps
the period's raw records and one unrelated record, preserving the observed
field layout; it does not copy production indexes or calculate ledger totals.

For both recall and append, a subprocess exits abruptly before writes,
after three committed record writes, after all writes but before completion,
after durable completion, and during restoration of a partial result.
SQLite stores intent and backup/plan/result hashes. Restart checks whether
the live trial table matches the before or after state; otherwise it restores
the verified backup and retries. A second resume must leave the completed
table unchanged. Each result must preserve the reference record bytes exactly.
Trial directories retain backups, plans, SQLite job state, and `report.json`.

This validates local recovery logic and repeated resume. It does not validate
SMB disconnects, server durability, partial network acknowledgments, FoxPro
indexes, ledger generation, or a production-wide job lock. The production
control worker adds index validation and a single-operation job lock; the
existing DCR writer is unchanged.

### fastsyg shared-station rehearsal

On October 3, 2026, the designated inactive test station `fastsyg` was used
for a September 2026 reopening/recall rehearsal. Verified copies of
`MONTHLY.DBF` and `MONTHLY.CDX` were saved under
`data/fast-tests/fastsyg-september-2026`, with a manifest and SQLite trial state.
`systemmonitor.fast_station_trial` restricts its plan to this station/period
and changes only September deletion markers. It refuses other DBF changes
or an index hash mismatch. This is a test utility, not the production writer.

A separate temporary writable mount of
`//192.168.0.234/fast_system/fastsyg/DBASE` was used; the main FAST mount
remained read-only. All 1,094 September records were flagged deleted, then
recall was interrupted after three committed marker updates. Restart recalled
the remaining records. Repeated recall made no further changes. Final DBF
and CDX hashes matched their original backups exactly; September ended with
1,094 active and zero deleted records. The temporary mount was removed.
`live-report.json` records the outcome alongside the backups.

The rehearsal tests process interruption after acknowledged writes over SMB.
It does not force a network disconnect, generate ledger summaries, or validate
FoxPro index behavior while records are temporarily deleted. Dashboard closing
controls remain disabled.

The web process reads SQLite observations. The worker reads the eight configured `lockmonth.dbf` files every 30 seconds and records detected access and closure attempts. DCR_LBASD, DCR_MNVP, DCR_Sygnal, and DCR_Synegia are excluded. The SQLite directory must stay on this server's local disk. The app uses the Python `dbf` package for DBF writes when enabled. Timestamps are stored in UTC and displayed using Asia/Manila.

## Read-only startup

1. Copy `.env.example` to `.env`, set a strong `SECRET_KEY`, and restrict the file to the service operator. `ADMIN_PASSWORD` seeds the initial `mis` account when there are no users; set it for a fresh installation so MIS can issue invitations. Existing installations retain their stored accounts; registered users have hashed passwords in SQLite. Set `ENABLE_WRITES=false` to disable DBF changes or `true` to enable dashboard openings and scheduled closures.
2. Ensure the host `data` directory is writable by UID 1000 and the service account can write the System3 share. This Compose configuration uses the local `/mnt/system3` share and the existing external `proxy` network.
3. Run `docker compose up -d --build`. Check `docker compose ps`, then `docker compose logs worker` and `docker compose logs web`.
4. Add `deploy/Caddyfile.fragment` inside the site's Caddy block before the fallback `handle`, adapt the upstream name if Compose created a different name, then validate and reload Caddy.
5. Browse `/systemmonitor/` and use the sign-in page. The Systems home page links to DCR access at `/systemmonitor/dcr` and FAST periods at `/systemmonitor/fast`. Existing installations retain `mis` with the previous password. New users need a single-use registration link generated by MIS on the Invitations page. Registered users can view the DCR dashboard/audit trail and perform enabled access changes. The DCR Refresh health panel must show eight successful reads.

## Accounts and audit history

Login and registration are available at `/systemmonitor/login` and
`/systemmonitor/register`. The SvelteKit forms use the Python JSON API at `/systemmonitor/api`. Mutating requests include the session token in `X-CSRF-Token`; sign-out is a protected POST. Account passwords
are hashed with Werkzeug scrypt; signed sessions use the persistent `SECRET_KEY`,
HTTP-only cookies, and SameSite Strict. Keep the same secret across restarts.

The Audit trail page at `/systemmonitor/audit` shows openings, deadline changes,
manual and automatic closures, failed actions, and **(Direct DCR Change)** events.
It supports application, source, and record-month filters with 50 events per page.
Dashboard actions capture the signed-in username and source IP. `TRUSTED_PROXY_HOST`
defaults to `caddy`: only that resolved proxy's forwarded client IP is accepted.
Restart the web service if the proxy is recreated with a new IP address.

Direct DCR changes are logged when observed, including changes during the normal
access window. Their timestamps are detection times, not exact DCR opening times;
changes that happen entirely between polls cannot be reconstructed. Successful
dashboard writes update the audit baseline to avoid duplicate DCR detections.
Historical events stay available, but earlier dashboard events cannot be assigned
retroactively to a personal account.

The header's system clock shows server time in Asia/Manila, which is also used
for deadlines. It advances every second and refreshes from `/systemmonitor/api/time`
every minute. If the time endpoint is unavailable, the header shows a warning
and continues from its last sample. This display does not set the host clock;
check host synchronization with `timedatectl status` if times differ.

The worker may initially show many externally opened months. An unscheduled previous-month opening is normal through the end of the 3rd in Manila. A detected exception gets a fixed next-midnight deadline. With writes enabled, due closures are applied by the Python DBF writer.

## Recovery and inspection

The `data/monitor.sqlite3` database contains schedules, observations, events, users, access baselines, and request identifiers. Back it up as an SQLite database while the processes run, or stop both processes and copy the SQLite file along with its WAL files. Never place it on the System3 share. A worker restart processes overdue schedules on its next tick. A failed closure stays listed and is retried. An early DCR closure removes the entry from the active list and remains in history. The protected status endpoint `/systemmonitor/api/status` returns cached health and schedules as JSON. The public interface shell contains no private data; authentication is enforced on the API.

Removing an application from the configured list retires its pending, active, and failed schedules with an `excluded` event on the next worker cycle. Its old observations and events remain in SQLite, but it disappears from the dashboard and is no longer read or closed by the worker.

The application keeps both processes separate to prevent a web request from performing a background poll. Stop the worker to pause monitoring; stopping only the web process does not pause the worker.

## Python DBF writer

`systemmonitor/dbf_writer.py` opens the selected table with the Python `dbf` package, checks the schema and unique year/month and RECID, compares the current ALLOW value with the expected value, changes ALLOW, and verifies the non-ALLOW fields and resulting row. The DBF package does not coordinate writes with FoxPro record locks and does not update persistent CDX indexes. A local copy of DCR_Main's complete DBF/CDX/DBC companions was opened and closed with ALLOW changed; all other parsed fields remained unchanged, the CDX hash remained unchanged, and the copied files were restored. Verify the current table's CDX tags and behavior in a DCR test application after any data-layout change.

The service serializes its own worker and dashboard updates using a local SQLite operation lock. It does not serialize with other FoxPro clients. Set `ENABLE_WRITES=false` to disable DBF mutations. The writer only accepts configured application paths and checks record identity and expected ALLOW before each update.

Registration requires a single-use invitation created by `mis` from **Invitations**. Links expire after 48 hours and can be revoked before use. Share the generated link directly; raw invitation tokens are displayed only at creation and stored as SHA-256 hashes. New passwords require at least 4 characters. Existing accounts and passwords are retained.

## SvelteKit build and API

The Docker build uses Bun 1.4.2 and the frozen `frontend/bun.lock`. The browser interface is compiled with SvelteKit's static adapter, including a fallback for deep-link reloads. Flask serves it from `systemmonitor/frontend` inside the image; for a local build set `FRONTEND_BUILD=frontend/build`. The existing Caddy route and port remain unchanged.

The authenticated JSON API provides `/status`, `/audit`, `/time`, `/open-options`, `/open`, `/close/<id>`, `/invitations`, and `/invitations/<id>/revoke` below `/systemmonitor/api`. `/session` supplies the current account, CSRF token, write mode, and server clock; `/login` and invitation-gated `/register` are public authentication endpoints. The API omits IP addresses from audit responses. The worker and DBF writer are independent of the frontend.
