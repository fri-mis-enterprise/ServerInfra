#!/usr/bin/env bash
# SQL Data Backup — latest *_backup_*.bak per DB prefix

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <target>" >&2
  exit 1
fi

# shellcheck disable=SC1091
source /opt/backups/lib/common.sh
load_target "$TARGET"

JOB="sql"
STATUS_KEY="${TARGET}_${JOB}"
SRC="${SQL_SRC:-/mnt/sql_database}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MOUNT_POINT="/tmp/sqlbak_dest_${TARGET}_${TIMESTAMP}_$$"
LOG="$BACKUP_LOG_DIR/sql_${TARGET}_${TIMESTAMP}.log"
SCRIPT_START=$SECONDS

cleanup() {
  unmount_cifs_share "$MOUNT_POINT"
  clear_running "$STATUS_KEY"
}
trap cleanup EXIT

fail() {
  local msg="$1"
  local total=$((SECONDS - SCRIPT_START))
  loud "FATAL: $msg"
  record_status "$STATUS_KEY" "FAIL" "$total" "-" "-" "$msg" "$LOG"
  report_failure "$JOB" "$TARGET" "$msg" "$LOG"
  exit 1
}

record_running "$STATUS_KEY" "$LOG" "Waiting for lock..."
acquire_lock "sql_backup" || fail "Timed out waiting for another SQL backup to finish"
update_phase "$STATUS_KEY" "Mounting //$DEST_IP/sql_database_backup..."

loud "========================================"
loud "SQL BACKUP STARTED (target: $TARGET)"
log "Host      : $(uname -n)"
log "Source    : $SRC"
log "Dest      : //$DEST_IP/sql_database_backup"
log "Timestamp : $TIMESTAMP"

mountpoint -q "$SRC" 2>/dev/null || fail "Source is not mounted: $SRC"

mount_cifs_share "//$DEST_IP/sql_database_backup" "$MOUNT_POINT" "$CRED_FILE" \
  || fail "Could not mount //$DEST_IP/sql_database_backup"

update_phase "$STATUS_KEY" "Selecting latest .bak files..."
declare -A latest_by_prefix=()
while IFS= read -r fname; do
  prefix="${fname%%_backup_*}"
  if [[ -z "${latest_by_prefix[$prefix]:-}" || "$fname" > "${latest_by_prefix[$prefix]}" ]]; then
    latest_by_prefix["$prefix"]="$fname"
  fi
done < <(find "$SRC" -maxdepth 1 -type f -name '*_backup_*.bak' -printf '%f\n')

[[ "${#latest_by_prefix[@]}" -gt 0 ]] || fail "No .bak files found in $SRC"

files=("${latest_by_prefix[@]}")
ARCHIVE_NAME="SQL_Backup_${TIMESTAMP}.tar.gz"
REMOTE_TEMP="$MOUNT_POINT/${ARCHIVE_NAME}.part"
REMOTE_ARCHIVE="$MOUNT_POINT/$ARCHIVE_NAME"

log "Selected ${#files[@]} latest backup file(s):"
for f in "${files[@]}"; do
  log "  $f"
done

update_phase "$STATUS_KEY" "Compressing ${#files[@]} .bak file(s) to $DEST_IP..."
loud "Compressing ${#files[@]} .bak file(s) directly to destination (.part)..."
rm -f "$REMOTE_TEMP"

mapfile -t TAR_COMP < <(tar_compress_args)
if ! tar -cf "$REMOTE_TEMP" "${TAR_COMP[@]}" -C "$SRC" "${files[@]}" >> "$LOG" 2>&1; then
  rm -f "$REMOTE_TEMP"
  fail "tar compression failed"
fi

update_phase "$STATUS_KEY" "Verifying remote archive..."
verify_tgz "$REMOTE_TEMP" || {
  rm -f "$REMOTE_TEMP"
  fail "Remote archive failed integrity check"
}

mv "$REMOTE_TEMP" "$REMOTE_ARCHIVE" >> "$LOG" 2>&1 || fail "Could not finalize remote archive"

ARCHIVE_SIZE=$(du -sh "$REMOTE_ARCHIVE" 2>/dev/null | cut -f1)
TOTAL_TIME=$((SECONDS - SCRIPT_START))

loud "DONE: $ARCHIVE_NAME [$ARCHIVE_SIZE] (${#files[@]} files) in $(elapsed "$TOTAL_TIME")"
record_status "$STATUS_KEY" "OK" "$TOTAL_TIME" "$ARCHIVE_NAME" "$ARCHIVE_SIZE" "Files: ${#files[@]}" "$LOG"
