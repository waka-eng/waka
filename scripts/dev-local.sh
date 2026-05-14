#!/usr/bin/env bash
set -euo pipefail

api_pid=""
web_pid=""
shutting_down=0
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_env_local() {
  local env_file="$repo_root/.env.local"

  export WAKA_API_DOTENV_PATH="$env_file"

  if [[ ! -f "$env_file" ]]; then
    echo "Warning: $env_file not found; continuing with existing environment only." >&2
    return 0
  fi

  local exports
  exports="$(ENV_FILE="$env_file" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

const envFile = process.env.ENV_FILE;
const parsed = parse(readFileSync(envFile));

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

for (const [key, value] of Object.entries(parsed)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    console.error(`Invalid environment variable name in .env.local: ${key}`);
    process.exitCode = 1;
    continue;
  }

  if (Object.prototype.hasOwnProperty.call(process.env, key)) {
    continue;
  }

  console.log(`export ${key}=${shellQuote(value)}`);
}
NODE
  )" || return 1

  if [[ -n "$exports" ]]; then
    eval "$exports"
  fi
}

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

load_env_local

export PORT=3010
export PUBLIC_API_URL="http://localhost:3010"
export PUBLIC_WEB_URL="http://127.0.0.1:5175"
export VITE_API_URL="http://localhost:3010"

if [[ "${WAKA_DEV_LOCAL_DRY_RUN:-}" == "1" ]]; then
  if [[ "$WAKA_API_DOTENV_PATH" != "$repo_root/.env.local" ]]; then
    echo "dev:local dry run failed: API dotenv path is not repo-root .env.local" >&2
    exit 1
  fi

  echo "dev:local dry run ok"
  exit 0
fi

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
