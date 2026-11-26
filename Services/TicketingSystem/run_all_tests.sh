#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/Frontend"
bun run check
bun test
bun run build
bun run test:server
