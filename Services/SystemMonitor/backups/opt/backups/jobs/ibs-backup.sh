#!/usr/bin/env bash
# IBS PostgreSQL Backup — parallel pg_dump of all 5 IBS DBs, verified tar.gz, cleanup

set -euo pipefail

# shellcheck disable=SC1091
source /opt/backups/lib/common.sh

JOB="ibs"
STATUS_KEY="ibs"
IBS_CONF="$BACKUP_ETC/ibs.conf"
if [[ -f "$IBS_CONF" ]]; then
  # shellcheck disable=SC1090
  source "$IBS_CONF"
fi

PG_HOST="${PG_HOST:-34.71.89.115}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PGPASS_FILE="${PGPASS_FILE:-$BACKUP_ETC/creds/ibs.pgpass}"
IBS_BASE_DIR="${IBS_BASE_DIR:-/home/mis/IBS_Dumps}"

DATE_SQL=$(date +%m-%d-%Y)
DATE_ARCHIVE=$(date +%F)
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG="$BACKUP_LOG_DIR/ibs_${TIMESTAMP}.log"
SCRIPT_START=$SECONDS

cleanup() {
  clear_running "$STATUS_KEY"
}
trap cleanup EXIT

fail() {
  local msg="$1"
  local total=$((SECONDS - SCRIPT_START))
  loud "FATAL: $msg"
  record_status "$STATUS_KEY" "FAIL" "$total" "-" "-" "$msg" "$LOG"
  report_failure "$JOB" "ibs" "$msg" "$LOG"
  exit 1
}

record_running "$STATUS_KEY" "$LOG" "Waiting for lock..."
acquire_lock "ibs_backup" || fail "Timed out waiting for another IBS backup to finish"
update_phase "$STATUS_KEY" "Dumping PostgreSQL databases..."

[[ -f "$PGPASS_FILE" ]] || fail "pgpass file not found: $PGPASS_FILE"
export PGPASSFILE="$PGPASS_FILE"

declare -A DBS=(
  [ibs_prod]="Filpride"
  [syvill_ibs_prod]="Syvill"
  [mcy_ibs_prod]="Mcy"
  [bienes_ibs_prod]="Bienes"
  [mmsi_ibs_prod]="MMSI"
)

mkdir -p "$IBS_BASE_DIR/Archives"
for sub in "${DBS[@]}"; do
  mkdir -p "$IBS_BASE_DIR/$sub"
done

loud "========================================"
loud "IBS BACKUP STARTED"
log "Host   : $PG_HOST:$PG_PORT"
log "Output : $IBS_BASE_DIR"

declare -A PIDS=()
declare -A OUT_FILES=()

for db in "${!DBS[@]}"; do
  sub="${DBS[$db]}"
  out="$IBS_BASE_DIR/$sub/${db}_${DATE_SQL}.sql"
  OUT_FILES["$db"]="$out"
  log "Dumping $db -> $out"
  pg_dump -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$db" -f "$out" >> "$LOG" 2>&1 &
  PIDS["$db"]=$!
done

FAILED_DBS=()
for db in "${!PIDS[@]}"; do
  if ! wait "${PIDS[$db]}"; then
    FAILED_DBS+=("$db (pg_dump error)")
  elif [[ ! -s "${OUT_FILES[$db]}" ]]; then
    FAILED_DBS+=("$db (empty dump)")
  else
    log "OK: $db ($(du -sh "${OUT_FILES[$db]}" | cut -f1))"
  fi
done

if [[ "${#FAILED_DBS[@]}" -gt 0 ]]; then
  fail "Database dump failed: ${FAILED_DBS[*]}"
fi

ARCHIVE_NAME="IBS_Dumps_${DATE_ARCHIVE}.tar.gz"
ARCHIVE_TEMP="$IBS_BASE_DIR/Archives/${ARCHIVE_NAME}.part"
ARCHIVE_FINAL="$IBS_BASE_DIR/Archives/${ARCHIVE_NAME}"

update_phase "$STATUS_KEY" "Compressing dumps into $ARCHIVE_NAME..."
loud "Compressing dumps into $ARCHIVE_NAME..."
rm -f "$ARCHIVE_TEMP"

mapfile -t TAR_COMP < <(tar_compress_args)
if ! tar -cf "$ARCHIVE_TEMP" "${TAR_COMP[@]}" --exclude="Archives" -C "$IBS_BASE_DIR" . >> "$LOG" 2>&1; then
  rm -f "$ARCHIVE_TEMP"
  fail "tar compression failed"
fi

update_phase "$STATUS_KEY" "Verifying archive integrity..."
verify_tgz "$ARCHIVE_TEMP" || {
  rm -f "$ARCHIVE_TEMP"
  fail "Archive failed integrity check"
}

mv "$ARCHIVE_TEMP" "$ARCHIVE_FINAL" || fail "Could not finalize archive"

# Cleanup .sql files only after archive is verified and finalized
update_phase "$STATUS_KEY" "Cleaning up temporary .sql dumps..."
for sub in "${DBS[@]}"; do
  find "$IBS_BASE_DIR/$sub" -maxdepth 1 -type f -name "*.sql" -delete
done

ARCHIVE_SIZE=$(du -sh "$ARCHIVE_FINAL" 2>/dev/null | cut -f1)
TOTAL_TIME=$((SECONDS - SCRIPT_START))

loud "DONE: $ARCHIVE_NAME [$ARCHIVE_SIZE] (${#DBS[@]} DBs) in $(elapsed "$TOTAL_TIME")"
record_status "$STATUS_KEY" "OK" "$TOTAL_TIME" "$ARCHIVE_NAME" "$ARCHIVE_SIZE" "DBs: ${#DBS[@]}" "$LOG"
