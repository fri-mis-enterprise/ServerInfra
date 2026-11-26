#!/usr/bin/env bash
# Tightly-scoped root control helper for SystemBackups CLI and SystemMonitor backup-bridge.
# Security: strictly whitelists commands, units, timers, target names, and non-credential configs.

set -euo pipefail

BACKUP_ETC="/etc/backups"
SYSTEMD_DIR="/etc/systemd/system"
FAILURES_LOG="/var/log/vfp-backup/failures.log"
STAGING_DIR="/var/lib/vfp-backup/staging"
CFG_BACKUP_DIR="/var/lib/vfp-backup/config-backups"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

validate_target_name() {
  local target="$1"
  [[ "$target" =~ ^[a-z0-9][a-z0-9_-]{0,23}$ ]] || die "Invalid target name (use lowercase letters, digits, - or _): $target"
  [[ "$target" != "ibs" && "$target" != "all" ]] || die "Reserved target name: $target"
}

validate_existing_target() {
  local target="$1"
  validate_target_name "$target"
  [[ -f "$BACKUP_ETC/targets/${target}.conf" ]] || die "Target config not found: $target"
}

validate_timer() {
  local timer="$1"
  [[ "$timer" =~ ^(backup-target-[a-z0-9][a-z0-9_-]{0,23}\.timer|ibs-backup\.timer)$ ]] \
    || die "Timer not permitted: $timer"
  [[ -f "$SYSTEMD_DIR/$timer" ]] || die "Timer unit not found: $timer"
}

validate_service() {
  local unit="$1"
  [[ "$unit" =~ ^(backup-target@[a-z0-9][a-z0-9_-]{0,23}\.service|backup-job@[a-z0-9][a-z0-9_-]{0,23}_(fast|system3|sql)\.service|ibs-backup\.service)$ ]] \
    || die "Service unit not permitted: $unit"
}

CMD="${1:-}"
shift || true

case "$CMD" in
  health)
    echo "OK"
    ;;

  run-job)
    KEY="${1:-}"
    if [[ "$KEY" == "ibs" ]]; then
      systemctl start --no-block ibs-backup.service
      echo "Started ibs-backup.service"
    elif [[ "$KEY" =~ ^([a-z0-9][a-z0-9_-]{0,23})_(fast|system3|sql)$ ]]; then
      validate_existing_target "${BASH_REMATCH[1]}"
      systemctl start --no-block "backup-job@${KEY}.service"
      echo "Started backup-job@${KEY}.service"
    else
      die "Invalid job key: $KEY"
    fi
    ;;

  run-target)
    TARGET="${1:-}"
    if [[ "$TARGET" == "ibs" ]]; then
      systemctl start --no-block ibs-backup.service
      echo "Started ibs-backup.service"
    else
      validate_existing_target "$TARGET"
      systemctl start --no-block "backup-target@${TARGET}.service"
      echo "Started backup-target@${TARGET}.service"
    fi
    ;;

  run-ibs)
    systemctl start --no-block ibs-backup.service
    echo "Started ibs-backup.service"
    ;;

  run-all)
    INCLUDE_IBS="${1:-1}"
    STARTED=()
    shopt -s nullglob
    for conf in "$BACKUP_ETC"/targets/*.conf; do
      target=$(basename "$conf" .conf)
      if [[ "$target" =~ ^[a-z0-9][a-z0-9_-]{0,23}$ ]]; then
        systemctl start --no-block "backup-target@${target}.service"
        STARTED+=("backup-target@${target}.service")
      fi
    done
    shopt -u nullglob
    if [[ "$INCLUDE_IBS" == "1" ]]; then
      systemctl start --no-block ibs-backup.service
      STARTED+=("ibs-backup.service")
    fi
    echo "Started: ${STARTED[*]:-none}"
    ;;

  stop-unit)
    UNIT="${1:-}"
    validate_service "$UNIT"
    systemctl stop "$UNIT"
    echo "Stopped $UNIT"
    ;;

  timer-enable)
    TIMER="${1:-}"
    validate_timer "$TIMER"
    systemctl enable --now "$TIMER"
    echo "Enabled $TIMER"
    ;;

  timer-disable)
    TIMER="${1:-}"
    validate_timer "$TIMER"
    systemctl disable --now "$TIMER"
    echo "Disabled $TIMER"
    ;;

  timer-schedule)
    TIMER="${1:-}"
    SCHEDULE="${2:-}"
    validate_timer "$TIMER"
    [[ -n "$SCHEDULE" ]] || die "Schedule cannot be empty"
    [[ "$SCHEDULE" != *$'\n'* && "$SCHEDULE" != *$'\r'* ]] || die "Schedule must be a single line"

    if command -v systemd-analyze >/dev/null 2>&1; then
      if ! systemd-analyze calendar "$SCHEDULE" >/dev/null 2>&1; then
        die "Invalid systemd OnCalendar expression: $SCHEDULE"
      fi
    fi

    UNIT_FILE="$SYSTEMD_DIR/$TIMER"
    mkdir -p "$CFG_BACKUP_DIR"
    cp "$UNIT_FILE" "$CFG_BACKUP_DIR/${TIMER}.$(date +%Y%m%d_%H%M%S).bak"

    TMP_UNIT=$(mktemp "$SYSTEMD_DIR/.${TIMER}.XXXXXX")
    awk -v sched="$SCHEDULE" '
      BEGIN { replaced = 0 }
      /^OnCalendar=/ { print "OnCalendar=" sched; replaced = 1; next }
      { print }
      END { if (!replaced) print "OnCalendar=" sched }
    ' "$UNIT_FILE" > "$TMP_UNIT"
    chmod 0644 "$TMP_UNIT"
    mv "$TMP_UNIT" "$UNIT_FILE"

    systemctl daemon-reload
    if systemctl is-active --quiet "$TIMER" 2>/dev/null; then
      systemctl restart "$TIMER"
    fi
    echo "Updated $TIMER schedule to: $SCHEDULE"
    ;;

  register-target)
    TARGET="${1:-}"
    DEST_IP="${2:-}"
    SCHEDULE="${3:-}"
    ENABLED="${4:-1}"
    KEEP_CRED="${5:-0}"

    validate_target_name "$TARGET"
    [[ "$DEST_IP" =~ ^[a-zA-Z0-9._-]+$ ]] || die "Invalid destination IP/host: $DEST_IP"
    [[ -n "$SCHEDULE" ]] || die "Schedule cannot be empty"
    [[ "$SCHEDULE" != *$'\n'* && "$SCHEDULE" != *$'\r'* ]] || die "Schedule must be a single line"
    [[ "$ENABLED" == "0" || "$ENABLED" == "1" ]] || die "Enabled must be 0 or 1"
    [[ "$KEEP_CRED" == "0" || "$KEEP_CRED" == "1" ]] || die "keep_cred must be 0 or 1"

    if command -v systemd-analyze >/dev/null 2>&1; then
      if ! systemd-analyze calendar "$SCHEDULE" >/dev/null 2>&1; then
        die "Invalid systemd OnCalendar expression: $SCHEDULE"
      fi
    fi

    # Read credentials from stdin: username=..., password=..., optional domain=...
    CRED_USER=""
    CRED_PASS=""
    CRED_DOMAIN=""
    while IFS='=' read -r k v; do
      v="${v%$'\r'}"
      case "$k" in
        username) CRED_USER="$v" ;;
        password) CRED_PASS="$v" ;;
        domain)   CRED_DOMAIN="$v" ;;
      esac
    done

    mkdir -p "$BACKUP_ETC/targets" "$CFG_BACKUP_DIR"
    install -d -m 0700 "$BACKUP_ETC/creds"

    CRED_FILE="$BACKUP_ETC/creds/${TARGET}.cred"
    if [[ "$KEEP_CRED" != "1" || ! -f "$CRED_FILE" ]]; then
      [[ -n "$CRED_USER" ]] || die "SMB username is required for new target credentials"
      TMP_CRED=$(mktemp "$BACKUP_ETC/creds/.${TARGET}.XXXXXX")
      {
        printf 'username=%s\n' "$CRED_USER"
        printf 'password=%s\n' "$CRED_PASS"
        if [[ -n "$CRED_DOMAIN" ]]; then
          printf 'domain=%s\n' "$CRED_DOMAIN"
        fi
      } > "$TMP_CRED"
      chmod 0600 "$TMP_CRED"
      mv "$TMP_CRED" "$CRED_FILE"
    fi

    CONF_FILE="$BACKUP_ETC/targets/${TARGET}.conf"
    TMP_CONF=$(mktemp "$BACKUP_ETC/targets/.${TARGET}.XXXXXX")
    {
      printf 'DEST_IP="%s"\n' "$DEST_IP"
      printf 'CRED_FILE="%s"\n' "$CRED_FILE"
    } > "$TMP_CONF"
    chmod 0644 "$TMP_CONF"
    mv "$TMP_CONF" "$CONF_FILE"

    TIMER_NAME="backup-target-${TARGET}.timer"
    TIMER_FILE="$SYSTEMD_DIR/$TIMER_NAME"
    TMP_TIMER=$(mktemp "$SYSTEMD_DIR/.${TIMER_NAME}.XXXXXX")
    cat > "$TMP_TIMER" <<EOF
[Unit]
Description=Scheduled backups for ${TARGET} (${DEST_IP})

[Timer]
Unit=backup-target@${TARGET}.service
OnCalendar=${SCHEDULE}
Persistent=false

[Install]
WantedBy=timers.target
EOF
    chmod 0644 "$TMP_TIMER"
    mv "$TMP_TIMER" "$TIMER_FILE"

    systemctl daemon-reload
    if [[ "$ENABLED" == "1" ]]; then
      systemctl enable --now "$TIMER_NAME"
      systemctl restart "$TIMER_NAME" 2>/dev/null || true
    else
      systemctl disable --now "$TIMER_NAME" 2>/dev/null || true
    fi
    echo "Registered target ${TARGET} (${DEST_IP}) with schedule: ${SCHEDULE}"
    ;;

  delete-target)
    TARGET="${1:-}"
    validate_existing_target "$TARGET"
    TIMER_NAME="backup-target-${TARGET}.timer"
    systemctl stop "backup-target@${TARGET}.service" 2>/dev/null || true
    systemctl disable --now "$TIMER_NAME" 2>/dev/null || true
    rm -f "$SYSTEMD_DIR/$TIMER_NAME"
    rm -f "$BACKUP_ETC/targets/${TARGET}.conf"
    rm -f "$BACKUP_ETC/creds/${TARGET}.cred"
    systemctl daemon-reload
    echo "Deleted backup target: ${TARGET}"
    ;;

  set-config)
    CFG_ID="${1:-}"
    DEST=""
    case "$CFG_ID" in
      backup) DEST="$BACKUP_ETC/backup.conf" ;;
      ibs)    DEST="$BACKUP_ETC/ibs.conf" ;;
      notify) DEST="$BACKUP_ETC/notify.conf" ;;
      *)
        die "Config target not permitted: $CFG_ID"
        ;;
    esac

    TMP_CFG=$(mktemp "${BACKUP_ETC}/.cfg.XXXXXX")
    trap 'rm -f "$TMP_CFG"' EXIT
    head -c 65536 > "$TMP_CFG"
    sed -i 's/\r$//' "$TMP_CFG"

    if ! bash -n "$TMP_CFG" 2>&1; then
      die "Config syntax check failed (bash -n)"
    fi

    mkdir -p "$CFG_BACKUP_DIR"
    if [[ -f "$DEST" ]]; then
      cp "$DEST" "$CFG_BACKUP_DIR/${CFG_ID}.$(date +%Y%m%d_%H%M%S).bak"
    fi

    chmod 0644 "$TMP_CFG"
    mv "$TMP_CFG" "$DEST"
    trap - EXIT
    echo "Saved $DEST"
    ;;

  test-notify)
    TARGET="${1:-test}"
    [[ "$TARGET" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Invalid target name: $TARGET"
    /opt/backups/notify.sh "test" "$TARGET" "Test alert triggered from SystemMonitor" "$FAILURES_LOG"
    echo "Sent test notification for target: $TARGET"
    ;;

  clear-failures)
    mkdir -p "$(dirname "$FAILURES_LOG")"
    : > "$FAILURES_LOG"
    chmod 0644 "$FAILURES_LOG"
    echo "Cleared $FAILURES_LOG"
    ;;

  rebuild-manifest)
    rm -f "$STAGING_DIR/fast_manifest.txt" "$STAGING_DIR/fast_stations.txt"
    echo "Cleared FAST station manifest cache (will rebuild on next FAST run)"
    ;;

  *)
    die "Unknown command: $CMD"
    ;;
esac
