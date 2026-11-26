#!/usr/bin/env bash
# Robust, idempotent host installer for SystemBackups + SystemMonitor backup-bridge
# Usage: sudo bash backups/install.sh [--user <username>] [--install-deps] [--no-timers] [--check]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_SOCKET="$MONITOR_DIR/data/backup-bridge.sock"

OPERATOR_USER=""
INSTALL_DEPS=0
ENABLE_TIMERS=1
CHECK_ONLY=0

usage() {
  cat <<EOF
Usage: sudo bash backups/install.sh [OPTIONS]

Options:
  --user <name>    Linux user granted passwordless backup-status CLI control
                   (defaults to \$SUDO_USER, or UID 1000 user)
  --install-deps   Automatically install missing packages (pacman / apt / dnf)
  --no-timers      Install systemd unit files without enabling/starting timers
  --check          Check dependencies and current installation without modifying files
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      [[ $# -ge 2 ]] || { echo "ERROR: --user requires a username" >&2; exit 1; }
      OPERATOR_USER="$2"
      shift 2
      ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    --no-timers)    ENABLE_TIMERS=0; shift ;;
    --check)        CHECK_ONLY=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              echo "ERROR: Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -t 1 ]]; then
  C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'
  C_CYAN='\033[0;36m'; C_BOLD='\033[1m'; C_RESET='\033[0m'
else
  C_GREEN='' C_YELLOW='' C_RED='' C_CYAN='' C_BOLD='' C_RESET=''
fi

info() { printf "${C_CYAN}==>${C_RESET} ${C_BOLD}%s${C_RESET}\n" "$*"; }
ok()   { printf "  ${C_GREEN}[OK]${C_RESET}   %s\n" "$*"; }
warn() { printf "  ${C_YELLOW}[WARN]${C_RESET} %s\n" "$*"; }
err()  { printf "  ${C_RED}[FAIL]${C_RESET} %s\n" "$*" >&2; }

detect_pkg_mgr() {
  if command -v pacman >/dev/null 2>&1; then echo "pacman"
  elif command -v apt-get >/dev/null 2>&1; then echo "apt"
  elif command -v dnf >/dev/null 2>&1; then echo "dnf"
  else echo "unknown"
  fi
}

detect_operator_user() {
  if [[ -n "$OPERATOR_USER" ]]; then echo "$OPERATOR_USER"; return; fi
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then echo "$SUDO_USER"; return; fi
  awk -F: '$3==1000 {print $1; exit}' /etc/passwd 2>/dev/null || true
}

check_dependencies() {
  info "Checking host dependencies..."
  local pkg_mgr; pkg_mgr=$(detect_pkg_mgr)
  local missing_pkgs=() missing_opt=()

  check_cmd() {
    local cmd="$1" label="$2" pkg_arch="$3" pkg_deb="$4" required="$5"
    if command -v "$cmd" >/dev/null 2>&1 || [[ -x "/sbin/$cmd" || -x "/usr/sbin/$cmd" ]]; then
      ok "$label ($cmd)"
    else
      if [[ "$required" == "1" ]]; then
        warn "$label missing ($cmd)"
        [[ "$pkg_mgr" == "pacman" ]] && missing_pkgs+=("$pkg_arch")
        [[ "$pkg_mgr" == "apt" || "$pkg_mgr" == "dnf" ]] && missing_pkgs+=("$pkg_deb")
      else
        warn "$label not installed (optional: $cmd)"
        [[ "$pkg_mgr" == "pacman" ]] && missing_opt+=("$pkg_arch")
        [[ "$pkg_mgr" == "apt" || "$pkg_mgr" == "dnf" ]] && missing_opt+=("$pkg_deb")
      fi
    fi
  }

  check_cmd bash       "Bash shell"        bash            bash               1
  check_cmd tar        "GNU tar"           tar             tar                1
  check_cmd flock      "flock locking"     util-linux      util-linux         1
  check_cmd mount.cifs "CIFS/SMB mounts"   cifs-utils      cifs-utils         1
  check_cmd pg_dump    "PostgreSQL client" postgresql-libs postgresql-client  1
  check_cmd python3    "Python 3"          python          python3            1
  check_cmd sudo       "sudo"              sudo            sudo               1
  check_cmd pigz       "pigz (fast gzip)"  pigz            pigz               0
  check_cmd curl       "curl (webhooks)"   curl            curl               0

  if command -v msmtp >/dev/null 2>&1; then ok "Email sender (msmtp)"
  elif command -v mail >/dev/null 2>&1; then ok "Email sender (mail)"
  else warn "No email sender found (optional: msmtp or mailutils)"
  fi

  if [[ "$INSTALL_DEPS" == "1" && "$CHECK_ONLY" == "0" ]]; then
    local to_install=("${missing_pkgs[@]}" "${missing_opt[@]}")
    if [[ "${#to_install[@]}" -gt 0 ]]; then
      info "Installing missing packages via $pkg_mgr: ${to_install[*]}"
      case "$pkg_mgr" in
        pacman) pacman -Sy --needed --noconfirm "${to_install[@]}" ;;
        apt)    apt-get update && apt-get install -y "${to_install[@]}" ;;
        dnf)    dnf install -y "${to_install[@]}" ;;
      esac
    fi
  fi
}

if [[ "$CHECK_ONLY" == "1" ]]; then
  check_dependencies
  info "Checking installed services & bridge..."
  [[ -x /opt/backups/backup-ctl.sh ]] && ok "/opt/backups/backup-ctl.sh present" || warn "/opt/backups/backup-ctl.sh not installed"
  [[ -S "$BRIDGE_SOCKET" ]] && ok "Bridge socket active: $BRIDGE_SOCKET" || warn "Bridge socket not active yet: $BRIDGE_SOCKET"
  systemctl is-active --quiet backup-bridge.service 2>/dev/null && ok "backup-bridge.service active" || warn "backup-bridge.service not active"
  exit 0
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root: sudo bash backups/install.sh" >&2
  exit 1
fi

OPERATOR_USER=$(detect_operator_user)
if [[ -n "$OPERATOR_USER" ]] && ! id "$OPERATOR_USER" >/dev/null 2>&1; then
  err "Specified operator user '$OPERATOR_USER' does not exist!"
  exit 1
fi

check_dependencies

info "Installing host backup scripts & bridge to /opt/backups..."
install -d -m 0755 /opt/backups /opt/backups/lib /opt/backups/jobs
install -m 0644 "$SCRIPT_DIR/opt/backups/lib/common.sh" /opt/backups/lib/common.sh
install -m 0755 "$SCRIPT_DIR/opt/backups/run-target.sh" /opt/backups/run-target.sh
install -m 0755 "$SCRIPT_DIR/opt/backups/run-job.sh" /opt/backups/run-job.sh
install -m 0755 "$SCRIPT_DIR/opt/backups/backup-ctl.sh" /opt/backups/backup-ctl.sh
install -m 0755 "$SCRIPT_DIR/opt/backups/notify.sh" /opt/backups/notify.sh
install -m 0755 "$SCRIPT_DIR/opt/backups/backup-status.sh" /opt/backups/backup-status.sh
install -m 0644 "$SCRIPT_DIR/opt/backups/backup_engine.py" /opt/backups/backup_engine.py
install -m 0755 "$SCRIPT_DIR/opt/backups/backup_cli.py" /opt/backups/backup_cli.py
install -m 0755 "$SCRIPT_DIR/opt/backups/backup-bridge.py" /opt/backups/backup-bridge.py

for job in fast-backup.sh system3-backup.sh sql-backup.sh ibs-backup.sh; do
  install -m 0755 "$SCRIPT_DIR/opt/backups/jobs/$job" "/opt/backups/jobs/$job"
done

# Clean up legacy Textual TUI files if previously installed
rm -rf /opt/backups/tui /opt/backups/backup-tui.sh /usr/local/bin/backup-tui 2>/dev/null || true
ln -sf /opt/backups/backup-status.sh /usr/local/bin/backup-status
ok "Installed /opt/backups and linked /usr/local/bin/backup-status"

info "Installing configs to /etc/backups (preserving existing configs & creds)..."
install -d -m 0755 /etc/backups /etc/backups/targets
install -d -m 0700 /etc/backups/creds

for f in backup.conf notify.conf ibs.conf; do
  if [[ ! -f "/etc/backups/$f" ]]; then
    install -m 0644 "$SCRIPT_DIR/etc/backups/$f" "/etc/backups/$f"
    ok "Created /etc/backups/$f"
  else
    ok "Keeping existing /etc/backups/$f"
  fi
done

shopt -s nullglob
for src_t in "$SCRIPT_DIR"/etc/backups/targets/*.conf; do
  t=$(basename "$src_t")
  if [[ ! -f "/etc/backups/targets/$t" ]]; then
    install -m 0644 "$src_t" "/etc/backups/targets/$t"
    ok "Created /etc/backups/targets/$t"
  else
    ok "Keeping existing /etc/backups/targets/$t"
  fi
done
shopt -u nullglob

for c in roi.cred leo.cred dan.cred ibs.pgpass; do
  if [[ ! -f "/etc/backups/creds/$c" ]]; then
    if [[ -f "$SCRIPT_DIR/etc/backups/creds/$c" ]]; then
      install -m 0600 "$SCRIPT_DIR/etc/backups/creds/$c" "/etc/backups/creds/$c"
      ok "Created /etc/backups/creds/$c (mode 0600)"
    elif [[ -f "$SCRIPT_DIR/etc/backups/creds/${c}.example" ]]; then
      install -m 0600 "$SCRIPT_DIR/etc/backups/creds/${c}.example" "/etc/backups/creds/$c"
      warn "Created /etc/backups/creds/$c from template — update password or re-register in SystemMonitor"
    fi
  else
    chmod 0600 "/etc/backups/creds/$c"
    ok "Keeping existing /etc/backups/creds/$c (mode 0600)"
  fi
done

info "Creating runtime state, log, and lock directories..."
install -d -m 0755 \
  /var/log/vfp-backup \
  /var/lib/vfp-backup/staging \
  /var/lib/vfp-backup/status \
  /var/lib/vfp-backup/running \
  /var/lib/vfp-backup/config-backups \
  /run/lock/vfp-backup

find /var/lib/vfp-backup/status /var/lib/vfp-backup/running /var/log/vfp-backup \
  -maxdepth 1 -type f -exec chmod 0644 {} + 2>/dev/null || true

install -d -m 0755 /etc/tmpfiles.d
install -m 0644 "$SCRIPT_DIR/etc/tmpfiles.d/vfp-backup.conf" /etc/tmpfiles.d/vfp-backup.conf
systemd-tmpfiles --create /etc/tmpfiles.d/vfp-backup.conf 2>/dev/null || true

info "Configuring non-root CLI permissions (backup-ops)..."
getent group backup-ops >/dev/null 2>&1 || groupadd --system backup-ops
if [[ -n "$OPERATOR_USER" ]]; then
  usermod -aG backup-ops "$OPERATOR_USER"
  ok "Added $OPERATOR_USER to backup-ops"
  if getent group systemd-journal >/dev/null 2>&1; then
    usermod -aG systemd-journal "$OPERATOR_USER"
  fi
fi

if [[ -d /etc/polkit-1/rules.d ]]; then
  install -m 0644 "$SCRIPT_DIR/etc/polkit-1/rules.d/50-system-backups.rules" /etc/polkit-1/rules.d/50-system-backups.rules
fi

if [[ -d /etc/sudoers.d ]]; then
  TMP_SUDOERS=$(mktemp)
  {
    echo "# Managed by SystemMonitor/backups/install.sh"
    echo "%backup-ops ALL=(root) NOPASSWD: /opt/backups/backup-ctl.sh"
    if [[ -n "$OPERATOR_USER" ]]; then
      echo "${OPERATOR_USER} ALL=(root) NOPASSWD: /opt/backups/backup-ctl.sh"
    fi
  } > "$TMP_SUDOERS"
  chmod 0440 "$TMP_SUDOERS"
  if command -v visudo >/dev/null 2>&1; then
    visudo -cf "$TMP_SUDOERS" >/dev/null
  fi
  mv "$TMP_SUDOERS" /etc/sudoers.d/system-backups
  chown root:root /etc/sudoers.d/system-backups
  chmod 0440 /etc/sudoers.d/system-backups
  ok "Installed & validated /etc/sudoers.d/system-backups"
fi

info "Installing systemd services, bridge daemon, and timers..."
for unit in backup-target@.service backup-job@.service ibs-backup.service; do
  install -m 0644 "$SCRIPT_DIR/etc/systemd/system/$unit" "/etc/systemd/system/$unit"
done

# Render backup-bridge.service pointing to this SystemMonitor's data directory
BRIDGE_UID=$(id -u "${OPERATOR_USER:-mis}" 2>/dev/null || echo 1000)
BRIDGE_GID=$(id -g "${OPERATOR_USER:-mis}" 2>/dev/null || echo 1000)
sed \
  -e "s|BACKUP_BRIDGE_SOCKET=.*|BACKUP_BRIDGE_SOCKET=${BRIDGE_SOCKET}|" \
  -e "s|BACKUP_BRIDGE_UID=.*|BACKUP_BRIDGE_UID=${BRIDGE_UID}|" \
  -e "s|BACKUP_BRIDGE_GID=.*|BACKUP_BRIDGE_GID=${BRIDGE_GID}|" \
  "$SCRIPT_DIR/etc/systemd/system/backup-bridge.service" > /etc/systemd/system/backup-bridge.service
chmod 0644 /etc/systemd/system/backup-bridge.service

TIMERS=()
shopt -s nullglob
for src_timer in "$SCRIPT_DIR"/etc/systemd/system/backup-target-*.timer "$SCRIPT_DIR"/etc/systemd/system/ibs-backup.timer; do
  tname=$(basename "$src_timer")
  TIMERS+=("$tname")
  if [[ ! -f "/etc/systemd/system/$tname" ]]; then
    install -m 0644 "$src_timer" "/etc/systemd/system/$tname"
  else
    ok "Keeping existing timer /etc/systemd/system/$tname"
  fi
done
shopt -u nullglob

sed -i 's/\r$//' \
  /opt/backups/lib/common.sh \
  /opt/backups/*.sh \
  /opt/backups/*.py \
  /opt/backups/jobs/*.sh \
  /etc/backups/*.conf \
  /etc/backups/targets/*.conf \
  /etc/systemd/system/backup-target* \
  /etc/systemd/system/backup-job@.service \
  /etc/systemd/system/backup-bridge.service \
  /etc/systemd/system/ibs-backup* 2>/dev/null || true

systemctl daemon-reload
systemctl enable --now backup-bridge.service
systemctl restart backup-bridge.service
ok "Started backup-bridge.service -> $BRIDGE_SOCKET"

if [[ "$ENABLE_TIMERS" == "1" && "${#TIMERS[@]}" -gt 0 ]]; then
  systemctl enable --now "${TIMERS[@]}"
  ok "Enabled backup timers: ${TIMERS[*]}"
fi

info "Running post-install verification..."
for shf in /opt/backups/lib/common.sh /opt/backups/*.sh /opt/backups/jobs/*.sh; do
  bash -n "$shf"
done
python3 -m py_compile /opt/backups/backup_engine.py /opt/backups/backup_cli.py /opt/backups/backup-bridge.py
ok "All shell and Python scripts verified"

sleep 0.5
if [[ -S "$BRIDGE_SOCKET" ]]; then
  ok "Bridge socket ready for SystemMonitor Docker container: $BRIDGE_SOCKET"
else
  warn "Bridge socket not visible yet — check: journalctl -u backup-bridge -n 20"
fi

echo ""
printf "${C_GREEN}${C_BOLD}Host backup suite & SystemMonitor bridge installed!${C_RESET}\n"
echo "Next: rebuild/restart SystemMonitor web UI:"
echo "  cd $MONITOR_DIR && docker compose up -d --build web"
