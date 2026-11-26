#!/usr/bin/env bash
# Runs a single backup job on demand (invoked by backup-job@.service)
# Instance format: "ibs" or "<target>_<fast|system3|sql>" (e.g. roi_sql)

set -euo pipefail

INSTANCE="${1:-}"
if [[ -z "$INSTANCE" ]]; then
  echo "Usage: $0 <ibs|target_job>" >&2
  exit 1
fi

if [[ "$INSTANCE" == "ibs" ]]; then
  exec /opt/backups/jobs/ibs-backup.sh
fi

if [[ "$INSTANCE" =~ ^([a-zA-Z0-9_-]+)_(fast|system3|sql)$ ]]; then
  TARGET="${BASH_REMATCH[1]}"
  JOB="${BASH_REMATCH[2]}"
  if [[ ! -f "/etc/backups/targets/${TARGET}.conf" ]]; then
    echo "FATAL: Unknown backup target: $TARGET" >&2
    exit 1
  fi
  exec "/opt/backups/jobs/${JOB}-backup.sh" "$TARGET"
fi

echo "FATAL: Invalid job instance '$INSTANCE' (expected 'ibs' or '<target>_<fast|system3|sql>')" >&2
exit 1
