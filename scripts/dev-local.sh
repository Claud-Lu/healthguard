#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  jobs -p | xargs -r kill
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"

PORT=3100 yarn dev:server &
yarn dev:demo &
yarn dev:dashboard &

cat <<'INFO'

HealthGuard local MVP is starting:
- Collector:  http://127.0.0.1:3100/health
- H5 demo:    http://127.0.0.1:5174/
- Dashboard:  http://127.0.0.1:5175/

Press Ctrl+C to stop all services.

INFO

wait
