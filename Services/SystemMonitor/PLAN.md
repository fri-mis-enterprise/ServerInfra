# System3 DCR month-access dashboard

## Goal

Build a small internal dashboard to monitor opened DCR months, allow selected
months until an explicitly chosen close date and time, and close access
automatically when that time arrives. Retain schedules across restarts in local
SQLite.

This is the agreed project plan, not a statement that the implementation is complete.

## Agreed behavior

- Select a DCR application, year, any individual months, and an exact close date
  and time in Asia/Manila, up to 90 days ahead.
- Opening January and March must leave February unchanged.
- Opening means setting the selected records' `ALLOW` field to `T`.
- An explicit open request also fills an empty `ALLOW` field with `True`, then
  applies the requested close deadline as usual.
- Expiry means setting `ALLOW` to `F` at the selected minute. A three-day default
  is provided; three days is 72 hours.
- Change only `ALLOW`; do not change `LOCKED` or other fields.
- Identify targets by application, year, and month. Refuse missing or ambiguous
  matches; verify record identity before updating.
- The DCR application already resets access around the 3rd of each month.
  Do not implement a replacement monthly reset.
- If DCR closes access early, mark it closed and do not reopen it automatically.
- A new explicit dashboard close time replaces the existing deadline for that month.
- Leave an empty `ALLOW` value for the current month unchanged. For the previous
  month, preserve normal access through the 3rd; starting on the 4th, fill an empty
  value with `False`, retaining and retrying the update if verification fails.

## Dashboard

Keep the main view short: a list of temporary openings and unexpected access,
showing application, month/year, scheduled close, and status.

Provide one **Open months** button and a form for application, year, individual
month checkboxes, and close date/time. Show refresh health and update failures clearly.
Active schedule rows include a **Close now** action in the status column. Manual
closure uses the same serialized, identity-checked Python DBF writer and retains
an immediately due deadline so the worker can retry an uncertain write.
Closed months disappear from the active list; preserve their history locally.

## Normal access and external openings

Use Asia/Manila for calendar rules and display. Store timestamps in UTC.

- Current-month access is normal and stays out of the exception list unless
  explicitly scheduled through this dashboard.
- Previous-month access through the entire 3rd day is also normal.
- Starting on the 4th, unscheduled previous-month access is unexpected.
- Detect `ALLOW = T` outside the normal window without a dashboard schedule.
  Label it **(Direct DCR Change)** and show the detection timestamp.
- Save the first detection time and schedule closure at the next Manila midnight.
- Refreshes and restarts must not extend that saved deadline.
- An explicit dashboard close time can replace the detected midnight deadline.

## Persistence and scheduling

SQLite lives on this server's local disk, separate from the System3 share.
It stores schedules, observations, submission identifiers, and execution history.
DBF remains the source of truth for actual access.

One periodic worker reconciles observations and processes due closures.
After restart, process overdue schedules. Failed closures remain visible and
are retried. Serialize changes so a worker cannot close a newly extended schedule
using an old deadline. Retain a pending schedule before attempting an external
write so an uncertain network response does not lose the expiry.

## Stack and deployment

- Python backend; Flask and server-rendered HTML.
- HTMX for partial refreshes and form interactions; no frontend build step.
- SQLite for durable schedules and history.
- Waitress for the web process and a separate Python worker.
- Docker Compose using the existing external `proxy` network.
- Caddy route intended at `/systemmonitor/`, following FastAudit's preserved-prefix
  setup. Existing reference: `/home/mis/Services/FastAudit/docker-compose.yml`.
- Existing proxy configuration: `/home/mis/Services/caddy/Caddyfile`.

## Live-data findings and write constraint

Read-only access to `/mnt/system3` succeeded on 2026-10-02. Twelve DCR application
folders have an immediate Data/data/DATA folder containing `lockmonth.dbf`.
Backup, old-data, and test copies also exist and must not be used as active sources.
The application paths are explicitly listed in `systemmonitor/config.py`.

Scope update: DCR_LBASD, DCR_MNVP, DCR_Sygnal, and DCR_Synegia are excluded from monitoring. Their historical observations and schedule events remain in SQLite; active schedules for them are retired when the worker starts.

The observed schema is `RECID I(4)`, `DATE D(8)`, `LOCKED L(1)`,
`LOCKEDBY C(4)`, `LOCKEDDATE T(8)`, `ALLOW L(1)`.
All inspected tables use the same schema; DCR_Sygnal and DCR_Synegia were empty.
The data folders contain `lockmonth.CDX` and `cashflow.dbc`.

The Linux reader opens DBF files in binary read-only mode. The Python `dbf`
package now performs writes when enabled: a local copy was opened and closed with
only `ALLOW` changed and the CDX hash unchanged. The package does not coordinate
with FoxPro record locks or maintain persistent indexes. The service serializes
its own worker and dashboard updates; external FoxPro clients are not covered by
that lock. This is the accepted Python-only write path.

## Status as of 2026-10-03

Completed and deployed:

- Dashboard with individual month checkboxes, precise Manila close date/time,
  health status, automatic partial refresh, and personal account authentication.
- Backend identity checks, SQLite connection cleanup, uncertain-write retention,
  duplicate record handling, and serialized schedule updates.
- Twenty-seven automated tests for selection, DBF writes including empty logical values, exact timestamp conversion, calendar
  boundaries, restarts, replacements, failures, exclusions, and concurrency.
- Docker Compose deployment, environment example, Caddy route, and runbook.
- Live share verification on the eight monitored DBF files; monitoring remains
  read-only at the source-reader level.
- Python DBF writer verified on a local full-folder copy; the test copy was restored.
- Per-row **Close now** action is deployed; manual closures are identity-checked,
  verified after writing, and retried by the worker if the result is uncertain.
- Empty current-month `ALLOW` values remain untouched. Empty previous-month values
  remain untouched through the 3rd and are durably changed to `False` from the 4th.
- DCR_LBASD, DCR_MNVP, DCR_Sygnal, and DCR_Synegia are excluded; their prior
  schedules remain in history as `excluded`.

The running service is configured with `ENABLE_WRITES=true`. The Python package
changes the DBF field directly and does not use the native FoxPro runtime.

The interface uses a minimal corporate design with status cards, a responsive
exceptions table, month-selection tiles and a live opening summary. Notifications
are dismissible; immediate closure has a confirmation dialog naming its target.
The header shows the scheduling server's clock in Asia/Manila, updates every
second and resynchronizes with the authenticated time endpoint every minute.
Login and registration use a persistent users table and hashed passwords. The existing `mis` account retains its password. Dashboard events record the signed-in username and source IP. The audit trail shows retained history and labels direct observations **(Direct DCR Change)** with detection timestamps; normal-window DCR openings are audited too.

## Collaboration note

Tool action logs are not visible to the user. Send concise progress updates as
files are completed and checks run, so ongoing work is visible without tool logs.

Registration requires a single-use invitation created by `mis` from **Invitations**. Links expire after 48 hours and can be revoked before use. Share the generated link directly; raw invitation tokens are displayed only at creation and stored as SHA-256 hashes. New passwords require at least 4 characters. Existing accounts and passwords are retained.
