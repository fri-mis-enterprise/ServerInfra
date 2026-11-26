#!/usr/bin/env bash
# Fast CLI wrapper for backup-status (exit 0 healthy, 1 fail/stale)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
exec python3 "$SCRIPT_DIR/backup_cli.py" "$@"
