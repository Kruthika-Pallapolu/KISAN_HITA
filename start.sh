#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

PORT="${PORT:-8000}"

echo "Starting Kisan Hita production server on port $PORT"
export GNANI_LIVE_ENABLED=true
export GNANI_ALLOW_PAID_LIVE_CALLS=true
exec python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port "$PORT"
