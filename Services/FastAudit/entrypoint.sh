#!/bin/sh
set -eu
mkdir -p /data
python3 /app/scanner/audit_scan.py "${FAST_ROOT:-/source}" "${AUDIT_DB:-/data/audit.db}" &
while ! python3 -c "import sqlite3; c=sqlite3.connect('${AUDIT_DB:-/data/audit.db}'); c.execute('select 1 from events limit 1')" 2>/dev/null; do sleep 1; done
exec bun run /app/web/server.ts
