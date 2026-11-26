#!/usr/bin/env bash
# Runs fast, system3, and sql backups in parallel for a given target (replaces Backup Executer)

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <roi|leo|dan>" >&2
  exit 1
fi

JOBS=(fast system3 sql)
declare -A PIDS=()

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup bundle for target: $TARGET"

for job in "${JOBS[@]}"; do
  "/opt/backups/jobs/${job}-backup.sh" "$TARGET" &
  PIDS["$job"]=$!
done

FAILED=0
for job in "${JOBS[@]}"; do
  if ! wait "${PIDS[$job]}"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] FAILED: $job ($TARGET)" >&2
    FAILED=1
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] OK: $job ($TARGET)"
  fi
done

exit "$FAILED"
