#!/usr/bin/env bash
# Fast System Backup — VFP key DBFs per station using cached manifest

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <target>" >&2
  exit 1
fi

# shellcheck disable=SC1091
source /opt/backups/lib/common.sh
load_target "$TARGET"

JOB="fast"
STATUS_KEY="${TARGET}_${JOB}"
FAST_SRC="${FAST_SRC:-/mnt/fast_system}"
MANIFEST="$BACKUP_STAGING_DIR/fast_manifest.txt"
STATION_CACHE="$BACKUP_STAGING_DIR/fast_stations.txt"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MOUNT_POINT="/tmp/fast_dest_${TARGET}_${TIMESTAMP}_$$"
LOG="$BACKUP_LOG_DIR/fast_${TARGET}_${TIMESTAMP}.log"

ARCHIVE_NAME="Fast_Backup_${TIMESTAMP}.tar.gz"
LOCAL_ARCHIVE="$BACKUP_STAGING_DIR/${ARCHIVE_NAME}.${TARGET}.$$"
SCRIPT_START=$SECONDS

CURRENT_STATIONS=""
NEW_STATION_LIST=""
REMOVED_STATION_LIST=""
NEW_ENTRIES=""
UPDATED_MANIFEST=""
UPDATED_STATIONS=""

cleanup() {
  rm -f "$CURRENT_STATIONS" "$NEW_STATION_LIST" "$REMOVED_STATION_LIST" \
        "$NEW_ENTRIES" "$UPDATED_MANIFEST" "$UPDATED_STATIONS" 2>/dev/null || true
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

FAST_FILES=(
  eina security tableref apledger sumpay gldet
  glsumm sysfile chracct supplier bank_db monthly
)

record_running "$STATUS_KEY" "$LOG" "Waiting for lock..."
acquire_lock "fast_backup" || fail "Timed out waiting for another fast backup to finish"
update_phase "$STATUS_KEY" "Checking station manifest..."

loud "========================================"
loud "FAST BACKUP STARTED (target: $TARGET)"
log "Host      : $(uname -n)"
log "Source    : $FAST_SRC"
log "Staging   : $BACKUP_STAGING_DIR"
log "Dest      : //$DEST_IP/FAST_BACKUP"
log "Timestamp : $TIMESTAMP"

[[ -d "$FAST_SRC" ]] || fail "Source directory does not exist: $FAST_SRC"
[[ -w "$BACKUP_STAGING_DIR" ]] || fail "Staging directory is not writable: $BACKUP_STAGING_DIR"

log "Staging free space: $(df -h "$BACKUP_STAGING_DIR" | awk 'NR==2 {print $4}')"

scan_station() {
  local station_dir="$1"
  local output_file="$2"
  local stncode datadir count=0

  stncode=$(basename "$station_dir")
  datadir="$station_dir/dbase"

  if [[ ! -d "$datadir" ]]; then
    log "NO DBASE : $stncode — no dbase/ subfolder"
    return 0
  fi

  while IFS= read -r -d '' file; do
    local filename filename_lower base_lower
    filename=$(basename "$file")
    filename_lower=${filename,,}
    base_lower=${filename_lower%.dbf}

    for wanted in "${FAST_FILES[@]}"; do
      if [[ "$base_lower" == "$wanted" ]]; then
        printf '%s\n' "$stncode/dbase/$filename" >> "$output_file"
        ((count++)) || true
        break
      fi
    done
  done < <(find "$datadir" -maxdepth 1 -type f -iname "*.dbf" -print0 2>/dev/null)

  if [[ "$count" -gt 0 ]]; then
    log "SCANNED  : $stncode ($count files)"
  else
    log "EMPTY    : $stncode — no matching DBFs"
  fi
}

MANIFEST_START=$SECONDS
NEW_STATIONS=0
REMOVED_STATIONS=0
SCANNED_STATIONS=0

CURRENT_STATIONS=$(mktemp)
NEW_STATION_LIST=$(mktemp)
REMOVED_STATION_LIST=$(mktemp)
NEW_ENTRIES=$(mktemp)
UPDATED_MANIFEST=$(mktemp)
UPDATED_STATIONS=$(mktemp)

loud "Checking FAST station manifest..."
find "$FAST_SRC" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -u > "$CURRENT_STATIONS"
[[ -s "$CURRENT_STATIONS" ]] || fail "No top-level directories found in $FAST_SRC"

if [[ ! -s "$MANIFEST" ]]; then
  loud "Manifest missing or empty — performing initial scan..."
  : > "$UPDATED_MANIFEST"
  while IFS= read -r station; do
    [[ -z "$station" ]] && continue
    scan_station "$FAST_SRC/$station" "$UPDATED_MANIFEST"
    ((SCANNED_STATIONS++)) || true
  done < "$CURRENT_STATIONS"

  [[ -s "$UPDATED_MANIFEST" ]] || fail "Initial manifest scan found no matching DBFs"
  sort -u "$UPDATED_MANIFEST" -o "$UPDATED_MANIFEST"
  mv "$UPDATED_MANIFEST" "$MANIFEST" || fail "Could not save manifest"
  cp "$CURRENT_STATIONS" "$STATION_CACHE" || fail "Could not save station cache"
elif [[ ! -s "$STATION_CACHE" ]]; then
  loud "Station cache missing — creating baseline..."
  cp "$CURRENT_STATIONS" "$STATION_CACHE" || fail "Could not create station cache"
else
  sort -u "$STATION_CACHE" -o "$STATION_CACHE"
  comm -23 "$CURRENT_STATIONS" "$STATION_CACHE" > "$NEW_STATION_LIST"
  comm -13 "$CURRENT_STATIONS" "$STATION_CACHE" > "$REMOVED_STATION_LIST"

  NEW_STATIONS=$(wc -l < "$NEW_STATION_LIST")
  REMOVED_STATIONS=$(wc -l < "$REMOVED_STATION_LIST")

  if [[ "$NEW_STATIONS" -eq 0 && "$REMOVED_STATIONS" -eq 0 ]]; then
    loud "No station changes detected."
  fi

  if [[ "$NEW_STATIONS" -gt 0 ]]; then
    loud "Detected $NEW_STATIONS new station director(ies)."
    : > "$NEW_ENTRIES"
    while IFS= read -r station; do
      [[ -z "$station" ]] && continue
      scan_station "$FAST_SRC/$station" "$NEW_ENTRIES"
      ((SCANNED_STATIONS++)) || true
    done < "$NEW_STATION_LIST"

    if [[ -s "$NEW_ENTRIES" ]]; then
      cat "$MANIFEST" "$NEW_ENTRIES" | sort -u > "$UPDATED_MANIFEST"
      cp "$UPDATED_MANIFEST" "$MANIFEST" || fail "Could not update manifest"
    fi
  fi

  if [[ "$REMOVED_STATIONS" -gt 0 ]]; then
    loud "Detected $REMOVED_STATIONS removed station director(ies)."
    cp "$MANIFEST" "$UPDATED_MANIFEST"
    while IFS= read -r station; do
      [[ -z "$station" ]] && continue
      awk -v station="$station" 'index($0, station "/") != 1' "$UPDATED_MANIFEST" > "${UPDATED_MANIFEST}.next"
      mv "${UPDATED_MANIFEST}.next" "$UPDATED_MANIFEST"
    done < "$REMOVED_STATION_LIST"

    [[ -s "$UPDATED_MANIFEST" ]] || fail "Manifest would become empty after removing stale stations"
    cp "$UPDATED_MANIFEST" "$MANIFEST" || fail "Could not clean manifest"
  fi

  cp "$CURRENT_STATIONS" "$UPDATED_STATIONS" && mv "$UPDATED_STATIONS" "$STATION_CACHE" \
    || fail "Could not update station cache"
fi

MANIFEST_TIME=$((SECONDS - MANIFEST_START))
FILE_COUNT=$(wc -l < "$MANIFEST")
[[ "$FILE_COUNT" -gt 0 ]] || fail "Manifest is empty"

loud "Manifest ready: $FILE_COUNT files ($(elapsed "$MANIFEST_TIME"))"

COMPRESS_START=$SECONDS
update_phase "$STATUS_KEY" "Compressing $FILE_COUNT files..."
loud "Compressing $FILE_COUNT files locally..."
rm -f "$LOCAL_ARCHIVE"

mapfile -t TAR_COMP < <(tar_compress_args)
if ! tar -cf "$LOCAL_ARCHIVE" "${TAR_COMP[@]}" -C "$FAST_SRC" -T "$MANIFEST" >> "$LOG" 2>&1; then
  rm -f "$LOCAL_ARCHIVE"
  fail "tar compression failed (manifest may be outdated: delete $MANIFEST to rebuild)"
fi

update_phase "$STATUS_KEY" "Verifying local archive..."
verify_tgz "$LOCAL_ARCHIVE" || { rm -f "$LOCAL_ARCHIVE"; fail "Local archive failed integrity check"; }

COMPRESS_TIME=$((SECONDS - COMPRESS_START))
ARCHIVE_SIZE=$(du -sh "$LOCAL_ARCHIVE" | cut -f1)
loud "Compression + check completed in $(elapsed "$COMPRESS_TIME") [$ARCHIVE_SIZE]"

MOUNT_START=$SECONDS
update_phase "$STATUS_KEY" "Mounting //$DEST_IP/FAST_BACKUP..."
mount_cifs_share "//$DEST_IP/FAST_BACKUP" "$MOUNT_POINT" "$CRED_FILE" \
  || fail "Could not mount //$DEST_IP/FAST_BACKUP (local archive retained: $LOCAL_ARCHIVE)"
MOUNT_TIME=$((SECONDS - MOUNT_START))

REMOTE_TEMP="$MOUNT_POINT/${ARCHIVE_NAME}.part"
REMOTE_ARCHIVE="$MOUNT_POINT/$ARCHIVE_NAME"

TRANSFER_START=$SECONDS
update_phase "$STATUS_KEY" "Transferring [$ARCHIVE_SIZE] to $DEST_IP..."
loud "Transferring archive to destination..."
rm -f "$REMOTE_TEMP"
if ! cp "$LOCAL_ARCHIVE" "$REMOTE_TEMP" >> "$LOG" 2>&1; then
  rm -f "$REMOTE_TEMP"
  fail "Transfer failed (local archive retained: $LOCAL_ARCHIVE)"
fi

update_phase "$STATUS_KEY" "Verifying remote archive..."
verify_tgz "$REMOTE_TEMP" || {
  rm -f "$REMOTE_TEMP"
  fail "Remote archive failed integrity check (local archive retained: $LOCAL_ARCHIVE)"
}

mv "$REMOTE_TEMP" "$REMOTE_ARCHIVE" >> "$LOG" 2>&1 \
  || fail "Could not finalize remote archive (local archive retained: $LOCAL_ARCHIVE)"

TRANSFER_TIME=$((SECONDS - TRANSFER_START))
rm -f "$LOCAL_ARCHIVE"

TOTAL_TIME=$((SECONDS - SCRIPT_START))
loud "DONE: $ARCHIVE_NAME [$ARCHIVE_SIZE] ($FILE_COUNT files) in $(elapsed "$TOTAL_TIME") [mount: $(elapsed "$MOUNT_TIME"), xfer: $(elapsed "$TRANSFER_TIME")]"

record_status "$STATUS_KEY" "OK" "$TOTAL_TIME" "$ARCHIVE_NAME" "$ARCHIVE_SIZE" "Files: $FILE_COUNT" "$LOG"
