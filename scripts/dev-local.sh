#!/usr/bin/env bash
set -euo pipefail

api_pid=""
shutting_down=0
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web_dist_dir="$repo_root/packages/web/dist"

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

  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  return "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

load_env_local

export PORT=3010
export PUBLIC_API_URL="http://localhost:3010"
export PUBLIC_WEB_URL="http://localhost:3010"
export VITE_API_URL=""
export VITE_SHOW_INTERNAL_STATUS=true
export WAKA_SHOW_INTERNAL_STATUS=true
export WAKA_SERVE_WEB_DIST=1
export WAKA_WEB_DIST_DIR="$web_dist_dir"

if [[ "${WAKA_DEV_LOCAL_DRY_RUN:-}" == "1" ]]; then
  if [[ "$WAKA_API_DOTENV_PATH" != "$repo_root/.env.local" ]]; then
    echo "dev:local dry run failed: API dotenv path is not repo-root .env.local" >&2
    exit 1
  fi

  if [[ "$PUBLIC_API_URL" != "http://localhost:3010" ]] || [[ "$PUBLIC_WEB_URL" != "http://localhost:3010" ]]; then
    echo "dev:local dry run failed: local API and web URLs must both use localhost:3010" >&2
    exit 1
  fi

  if [[ -n "$VITE_API_URL" ]]; then
    echo "dev:local dry run failed: VITE_API_URL must be empty so the built client uses same-origin API paths" >&2
    exit 1
  fi

  if [[ "${VITE_SHOW_INTERNAL_STATUS:-}" != "true" ]] || [[ "${WAKA_SHOW_INTERNAL_STATUS:-}" != "true" ]]; then
    echo "dev:local dry run failed: internal WOW status must be enabled for the local same-origin demo build and API" >&2
    exit 1
  fi

  if [[ "$WAKA_SERVE_WEB_DIST" != "1" ]] || [[ "$WAKA_WEB_DIST_DIR" != "$web_dist_dir" ]]; then
    echo "dev:local dry run failed: web dist serving is not configured" >&2
    exit 1
  fi

  echo "dev:local dry run ok"
  exit 0
fi

echo "Starting WAKA local dev (Option B monolithic)..."
echo "  Browser: http://localhost:3010"
echo "Building web app for same-origin API paths with internal demo status visible..."

pnpm --filter @waka/web build

echo "Starting monolithic local server. Press Ctrl+C to stop."

pnpm --filter @waka/api exec tsx src/server.ts &
api_pid=$!

wait "$api_pid"
