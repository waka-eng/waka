#!/usr/bin/env bash
set -euo pipefail

api_pid=""
web_pid=""
shutting_down=0

cleanup() {
  local exit_code=$?

  if [[ "$shutting_down" -eq 1 ]]; then
    return "$exit_code"
  fi
  shutting_down=1

  trap - EXIT INT TERM

  for pid in "$api_pid" "$web_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  wait 2>/dev/null || true
  return "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export PORT=3010
export PUBLIC_API_URL="http://localhost:3010"
export PUBLIC_WEB_URL="http://127.0.0.1:5175"
export VITE_API_URL="http://localhost:3010"

echo "Starting WAKA local dev (Option B)..."
echo "  API:    http://localhost:3010"
echo "  Health: http://localhost:3010/health"
echo "  Web:    http://127.0.0.1:5175"
echo "Press Ctrl+C to stop both servers."

pnpm --filter @waka/api exec tsx src/server.ts &
api_pid=$!

pnpm --filter @waka/web exec vite --host 127.0.0.1 --port 5175 --strictPort &
web_pid=$!

while true; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    set +e
    wait "$api_pid"
    exit_code=$?
    set -e
    echo "API server exited with code $exit_code; stopping web server."
    exit "$exit_code"
  fi

  if ! kill -0 "$web_pid" 2>/dev/null; then
    set +e
    wait "$web_pid"
    exit_code=$?
    set -e
    echo "Web server exited with code $exit_code; stopping API server."
    exit "$exit_code"
  fi

  sleep 1
done
