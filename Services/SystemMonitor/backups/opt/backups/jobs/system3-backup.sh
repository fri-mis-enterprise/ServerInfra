#!/usr/bin/env bash
# System3 Backup — VFP data directories (.dbf/.cdx/.fpt/.dbc/.dct/.dcx)

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <target>" >&2
  exit 1
fi

# shellcheck disable=SC1091
source /opt/backups/lib/common.sh
load_target "$TARGET"

JOB="system3"
STATUS_KEY="${TARGET}_${JOB}"
BASE="${SYSTEM3_SRC:-/mnt/system3}"
PLACEMENT_DATABASES="$BASE/Placement/Databases"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MOUNT_POINT="/tmp/vfp_dest_${TARGET}_${TIMESTAMP}_$$"
LOG="$BACKUP_LOG_DIR/system3_${TARGET}_${TIMESTAMP}.log"
FILE_LIST=""
SCRIPT_START=$SECONDS

cleanup() {
  rm -f "$FILE_LIST" 2>/dev/null || true
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
acquire_lock "vfp_backup" || fail "Timed out waiting for another System3 backup to finish"
update_phase "$STATUS_KEY" "Mounting //$DEST_IP/VFP_DATA_BACKUP..."

loud "========================================"
loud "SYSTEM3 (VFP) BACKUP STARTED (target: $TARGET)"
log "Host      : $(uname -n)"
log "Source    : $BASE"
log "Dest      : //$DEST_IP/VFP_DATA_BACKUP"
log "Timestamp : $TIMESTAMP"

mountpoint -q "$BASE" 2>/dev/null || fail "Source is not mounted: $BASE"

MOUNT_START=$SECONDS
mount_cifs_share "//$DEST_IP/VFP_DATA_BACKUP" "$MOUNT_POINT" "$CRED_FILE" \
  || fail "Could not mount //$DEST_IP/VFP_DATA_BACKUP"
MOUNT_TIME=$((SECONDS - MOUNT_START))

ARCHIVE_NAME="VFP_Backup_${TIMESTAMP}.tar.gz"
REMOTE_TEMP="$MOUNT_POINT/${ARCHIVE_NAME}.part"
REMOTE_ARCHIVE="$MOUNT_POINT/$ARCHIVE_NAME"

FILE_LIST=$(mktemp)
backed_up=0
empty=0
file_count=0

process_data_dir() {
  local datadir="$1"
  local rel="${datadir#"$BASE"/}"
  local found=0

  while IFS= read -r -d '' file; do
    printf '%s\0' "$rel/$(basename "$file")" >> "$FILE_LIST"
    ((found++)) || true
  done < <(
    find "$datadir" -maxdepth 1 -type f \
      \( -iname "*.dbf" -o -iname "*.cdx" -o -iname "*.fpt" \
         -o -iname "*.dbc" -o -iname "*.dct" -o -iname "*.dcx" \) \
      -print0 2>>"$LOG"
  )

  if [[ "$found" -eq 0 ]]; then
    log "EMPTY    : $rel — no VFP files"
    ((empty++)) || true
  else
    log "SELECTED : $rel ($found files)"
    ((backed_up++)) || true
    ((file_count += found)) || true
  fi
}

DISCOVERY_START=$SECONDS
update_phase "$STATUS_KEY" "Discovering VFP files..."
loud "Discovering data directories and VFP files..."

while IFS= read -r -d '' app_dir; do
  [[ "$app_dir" == "$BASE/Placement" ]] && continue
  while IFS= read -r -d '' datadir; do
    process_data_dir "$datadir"
  done < <(find "$app_dir" -mindepth 1 -maxdepth 1 -type d -iname "data" -print0)
done < <(find "$BASE" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

if [[ -d "$PLACEMENT_DATABASES" ]]; then
  while IFS= read -r -d '' datadir; do
    process_data_dir "$datadir"
  done < <(find "$PLACEMENT_DATABASES" -mindepth 2 -maxdepth 2 -type d -iname "data" -print0 | sort -z)
fi

DISCOVERY_TIME=$((SECONDS - DISCOVERY_START))
[[ "$file_count" -gt 0 ]] || fail "No VFP files found to archive"
loud "Selected $file_count files from $backed_up directories in $(elapsed "$DISCOVERY_TIME")"

COMPRESS_START=$SECONDS
update_phase "$STATUS_KEY" "Compressing $file_count files to $DEST_IP..."
loud "Compressing directly to destination (.part)..."
rm -f "$REMOTE_TEMP"

mapfile -t TAR_COMP < <(tar_compress_args)
if ! tar -cf "$REMOTE_TEMP" "${TAR_COMP[@]}" -C "$BASE" --null -T "$FILE_LIST" >> "$LOG" 2>&1; then
  rm -f "$REMOTE_TEMP"
  fail "tar compression failed"
fi

update_phase "$STATUS_KEY" "Verifying remote archive..."
verify_tgz "$REMOTE_TEMP" || {
  rm -f "$REMOTE_TEMP"
  fail "Remote archive failed integrity check"
}

mv "$REMOTE_TEMP" "$REMOTE_ARCHIVE" >> "$LOG" 2>&1 || fail "Could not finalize remote archive"

COMPRESS_TIME=$((SECONDS - COMPRESS_START))
ARCHIVE_SIZE=$(du -sh "$REMOTE_ARCHIVE" 2>/dev/null | cut -f1)
TOTAL_TIME=$((SECONDS - SCRIPT_START))

loud "DONE: $ARCHIVE_NAME [$ARCHIVE_SIZE] ($file_count files, $backed_up dirs) in $(elapsed "$TOTAL_TIME") [mount: $(elapsed "$MOUNT_TIME"), comp+check: $(elapsed "$COMPRESS_TIME")]"
record_status "$STATUS_KEY" "OK" "$TOTAL_TIME" "$ARCHIVE_NAME" "$ARCHIVE_SIZE" "Files: $file_count, Dirs: $backed_up" "$LOG"
