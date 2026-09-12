#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
set -a
. ./.env
set +a
command -v docker >/dev/null || { echo 'Docker is required'; exit 1; }
docker compose version >/dev/null || { echo 'Docker Compose is required'; exit 1; }
[ -d "$FAST_ROOT" ] || { echo "FAST_ROOT is not readable: $FAST_ROOT"; exit 1; }
count=$(find "$FAST_ROOT" -mindepth 3 -maxdepth 3 -type f -iname sumpay.dbf | wc -l)
[ "$count" -gt 0 ] || { echo "No direct station/DBASE/Sumpay.DBF files found"; exit 1; }
mkdir -p "$AUDIT_DATA"
echo "Found $count Sumpay files under $FAST_ROOT"
docker compose up -d --build
echo "FAST Audit: http://localhost:${PORT:-3000}"
