#!/usr/bin/env bash
# Failure reporting hook — logs locally + optionally sends Telegram / Discord / Slack / Email

set -euo pipefail

JOB="${1:-unknown}"
TARGET="${2:-unknown}"
MESSAGE="${3:-No error message}"
LOG_PATH="${4:-}"

HOST=$(uname -n)
NOW=$(date '+%Y-%m-%d %H:%M:%S')
FAILURES_LOG="/var/log/vfp-backup/failures.log"

mkdir -p "$(dirname "$FAILURES_LOG")"

# 1. Always log to persistent failures.log and syslog/journald
printf '[%s] FAIL | host=%s | target=%s | job=%s | msg=%s | log=%s\n' \
  "$NOW" "$HOST" "$TARGET" "$JOB" "$MESSAGE" "$LOG_PATH" >> "$FAILURES_LOG"
chmod 0644 "$FAILURES_LOG" 2>/dev/null || true
logger -t vfp-backup -p user.err "FAIL target=$TARGET job=$JOB msg=$MESSAGE log=$LOG_PATH" || true

# Load optional notification settings
NOTIFY_CONF="/etc/backups/notify.conf"
if [[ -f "$NOTIFY_CONF" ]]; then
  # shellcheck disable=SC1090
  source "$NOTIFY_CONF"
fi

TAIL_OUT=""
if [[ -n "$LOG_PATH" && -f "$LOG_PATH" ]]; then
  TAIL_OUT=$(tail -n 20 "$LOG_PATH" 2>/dev/null || true)
fi

BODY="BACKUP FAILED
Host:   $HOST
Time:   $NOW
Target: $TARGET
Job:    $JOB
Error:  $MESSAGE
Log:    $LOG_PATH"

if [[ -n "$TAIL_OUT" ]]; then
  BODY+=$'\n\n--- Last 20 log lines ---\n'"$TAIL_OUT"
fi

# JSON-escape helper using python3 or awk fallback
json_escape() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
  else
    awk 'BEGIN{RS="\0"} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); gsub(/\t/,"\\t"); gsub(/\r/,""); gsub(/\n/,"\\n"); printf "\"%s\"", $0}'
  fi
}

# 2. Telegram (optional)
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  curl -fsS --max-time 15 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${BODY:0:3900}" >/dev/null 2>&1 || true
fi

# 3. Discord webhook (optional)
if [[ -n "${DISCORD_WEBHOOK_URL:-}" ]]; then
  PAYLOAD=$(printf '{"content": %s}' "$(printf '```\n%s\n```' "${BODY:0:1900}" | json_escape)")
  curl -fsS --max-time 15 -H "Content-Type: application/json" \
    -d "$PAYLOAD" "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

# 4. Slack / Google Chat / generic JSON webhook (optional)
if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
  PAYLOAD=$(printf '{"text": %s}' "$(printf '%s' "${BODY:0:3500}" | json_escape)")
  curl -fsS --max-time 15 -H "Content-Type: application/json" \
    -d "$PAYLOAD" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

# 5. Email via msmtp (preferred) or mail/mailx (optional)
if [[ -n "${ALERT_EMAIL:-}" ]]; then
  if command -v msmtp >/dev/null 2>&1; then
    printf 'To: %s\nSubject: [BACKUP FAIL] %s: %s/%s\n\n%s\n' \
      "$ALERT_EMAIL" "$HOST" "$TARGET" "$JOB" "$BODY" | msmtp "$ALERT_EMAIL" || true
  elif command -v mail >/dev/null 2>&1; then
    printf '%s\n' "$BODY" | mail -s "[BACKUP FAIL] $HOST: $TARGET/$JOB" "$ALERT_EMAIL" || true
  fi
fi
