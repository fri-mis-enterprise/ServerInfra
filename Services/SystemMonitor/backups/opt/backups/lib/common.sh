#!/usr/bin/env bash
# Shared helpers for Linux backup jobs

set -euo pipefail

BACKUP_ETC="/etc/backups"
BACKUP_LOG_DIR="/var/log/vfp-backup"
BACKUP_STATE_DIR="/var/lib/vfp-backup/status"
BACKUP_RUNNING_DIR="/var/lib/vfp-backup/running"
BACKUP_STAGING_DIR="/var/lib/vfp-backup/staging"
BACKUP_LOCK_DIR="/run/lock/vfp-backup"

# Load global defaults if present
if [[ -f "$BACKUP_ETC/backup.conf" ]]; then
  # shellcheck disable=SC1091
  source "$BACKUP_ETC/backup.conf"
fi

VERIFY_ARCHIVE="${VERIFY_ARCHIVE:-1}"
LOCK_WAIT_SECS="${LOCK_WAIT_SECS:-300}"
CIFS_UID="${CIFS_UID:-1000}"
CIFS_GID="${CIFS_GID:-1000}"

mkdir -p "$BACKUP_LOG_DIR" "$BACKUP_STATE_DIR" "$BACKUP_RUNNING_DIR" "$BACKUP_STAGING_DIR" "$BACKUP_LOCK_DIR"

elapsed() {
  local duration="$1"
  printf '%dm %02ds' $((duration / 60)) $((duration % 60))
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
}

loud() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG"
}

# Pick pigz (multi-threaded gzip, 100% .tar.gz compatible) if installed
tar_compress_args() {
  if command -v pigz >/dev/null 2>&1; then
    printf '%s\n' "-I" "pigz"
  else
    printf '%s\n' "-z"
  fi
}

# Verify a .tar.gz archive is non-empty and passes gzip integrity check
verify_tgz() {
  local file="$1"
  if [[ ! -s "$file" ]]; then
    loud "CHECK FAIL: Archive is missing or 0 bytes: $file"
    return 1
  fi
  if [[ "$VERIFY_ARCHIVE" == "1" ]]; then
    if command -v pigz >/dev/null 2>&1; then
      pigz -t "$file" >> "$LOG" 2>&1
    else
      gzip -t "$file" >> "$LOG" 2>&1
    fi
  fi
}

# Load target config (/etc/backups/targets/<name>.conf)
load_target() {
  local target="$1"
  local conf="$BACKUP_ETC/targets/${target}.conf"
  if [[ ! -f "$conf" ]]; then
    echo "FATAL: Target config not found: $conf" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$conf"

  if [[ -z "${DEST_IP:-}" || -z "${CRED_FILE:-}" ]]; then
    echo "FATAL: DEST_IP and CRED_FILE must be set in $conf" >&2
    exit 1
  fi
  if [[ ! -f "$CRED_FILE" ]]; then
    echo "FATAL: Credentials file not found: $CRED_FILE" >&2
    exit 1
  fi
}

# Acquire exclusive lock per job+target (or global job lock)
acquire_lock() {
  local lock_name="$1"
  local lock_file="$BACKUP_LOCK_DIR/${lock_name}.lock"
  exec 200>"$lock_file"
  if ! flock -w "$LOCK_WAIT_SECS" 200; then
    loud "FATAL: Timed out waiting for lock ($lock_file)"
    return 1
  fi
}

# Mount CIFS share safely using credentials file (never exposes password in ps)
mount_cifs_share() {
  local share="$1"
  local mount_point="$2"
  local cred_file="$3"
  local mount_err

  mkdir -p "$mount_point"
  mount_err=$(mount -t cifs "$share" "$mount_point" \
    -o "credentials=${cred_file},uid=${CIFS_UID},gid=${CIFS_GID},file_mode=0777,dir_mode=0777" 2>&1) || true

  if ! mountpoint -q "$mount_point" 2>/dev/null; then
    loud "FATAL: Could not mount $share — $mount_err"
    return 1
  fi
  log "Mounted $share -> $mount_point"
}

unmount_cifs_share() {
  local mount_point="$1"
  if [[ -n "$mount_point" ]] && mountpoint -q "$mount_point" 2>/dev/null; then
    umount "$mount_point" 2>/dev/null || umount -l "$mount_point" 2>/dev/null || true
  fi
  [[ -n "$mount_point" ]] && rmdir "$mount_point" 2>/dev/null || true
}

# Track active/in-progress runs so backup-status and the TUI show live state
BACKUP_RUN_START_EPOCH=""
BACKUP_RUN_TIMESTAMP=""
BACKUP_RUN_LOG=""

record_running() {
  local key="$1"
  local log_path="$2"
  local phase="${3:-Starting...}"

  BACKUP_RUN_START_EPOCH=$(date +%s)
  BACKUP_RUN_TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  BACKUP_RUN_LOG="$log_path"

  if [[ -n "$log_path" ]]; then
    touch "$log_path" 2>/dev/null || true
    chmod 0644 "$log_path" 2>/dev/null || true
  fi

  local tmp
  tmp=$(mktemp "$BACKUP_RUNNING_DIR/.${key}.XXXXXX")
  cat > "$tmp" <<EOF
PID=$$
START_EPOCH=$BACKUP_RUN_START_EPOCH
TIMESTAMP=$BACKUP_RUN_TIMESTAMP
LOG=$BACKUP_RUN_LOG
PHASE=$phase
EOF
  chmod 0644 "$tmp"
  mv "$tmp" "$BACKUP_RUNNING_DIR/${key}.running"
}

update_phase() {
  local key="$1"
  local phase="$2"
  local start_epoch="${BACKUP_RUN_START_EPOCH:-$(date +%s)}"
  local start_ts="${BACKUP_RUN_TIMESTAMP:-$(date '+%Y-%m-%d %H:%M:%S')}"
  local log_path="${BACKUP_RUN_LOG:-${LOG:-}}"

  local tmp
  tmp=$(mktemp "$BACKUP_RUNNING_DIR/.${key}.XXXXXX")
  cat > "$tmp" <<EOF
PID=$$
START_EPOCH=$start_epoch
TIMESTAMP=$start_ts
LOG=$log_path
PHASE=$phase
EOF
  chmod 0644 "$tmp"
  mv "$tmp" "$BACKUP_RUNNING_DIR/${key}.running"
}

clear_running() {
  local key="$1"
  local run_file="$BACKUP_RUNNING_DIR/${key}.running"
  if [[ -f "$run_file" ]]; then
    local file_pid=""
    file_pid=$(awk -F= '$1=="PID"{print $2; exit}' "$run_file" 2>/dev/null || true)
    if [[ -z "$file_pid" || "$file_pid" == "$$" ]]; then
      rm -f "$run_file" 2>/dev/null || true
    fi
  fi
}

# Record machine-readable status for backup-status.sh and TUI
record_status() {
  local key="$1"        # e.g. roi_fast, leo_system3, ibs
  local status="$2"     # OK or FAIL
  local duration="$3"   # seconds
  local archive="$4"    # archive filename or "-"
  local size="$5"       # human size or "-"
  local message="$6"    # short summary or error
  local log_path="$7"

  local tmp
  tmp=$(mktemp "$BACKUP_STATE_DIR/.${key}.XXXXXX")
  cat > "$tmp" <<EOF
STATUS=$status
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
EPOCH=$(date +%s)
DURATION=$duration
ARCHIVE=$archive
SIZE=$size
MESSAGE=$message
LOG=$log_path
EOF
  chmod 0644 "$tmp"
  mv "$tmp" "$BACKUP_STATE_DIR/${key}.status"
  clear_running "$key"
}

# Trigger failure notification script
report_failure() {
  local job="$1"
  local target="$2"
  local message="$3"
  local log_path="$4"

  if [[ -x "/opt/backups/notify.sh" ]]; then
    /opt/backups/notify.sh "$job" "$target" "$message" "$log_path" || true
  fi
}
