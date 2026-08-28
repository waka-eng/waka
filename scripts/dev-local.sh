#!/usr/bin/env bash
set -euo pipefail

api_pid=""
watch_pid=""
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

  if [[ -n "$watch_pid" ]] && kill -0 "$watch_pid" 2>/dev/null; then
    kill "$watch_pid" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  return "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

load_env_local

# The port is one value in one place now. It was written out four times as a
# literal, so moving the stack to another port meant editing the API URL, the
# web URL, the dry-run guard and the printed line and getting all four to
# agree — and any one of them left behind sends Google an OAuth callback at a
# port nothing is listening on. Override with WAKA_LOCAL_PORT.
export PORT="${WAKA_LOCAL_PORT:-3010}"
local_origin="http://localhost:${PORT}"

# SAY WHO HAS THE PORT, rather than letting node throw EADDRINUSE.
#
# The failure mode this replaces: a previous `dev:local` is still running in a
# terminal you have closed or forgotten, and the new one dies eight lines into
# a stack trace about `::1:3010` — after building the web app and after the
# API has already done its startup work, so the useful output scrolls past the
# cause. The port is a one-line question; ask it before doing any of that.
if command -v lsof >/dev/null 2>&1; then
  holder="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "$holder" ]]; then
    holder_cmd="$(ps -p "$holder" -o comm= 2>/dev/null | tr -d ' ' || true)"
    cat >&2 <<MSG
Port ${PORT} is already in use by pid ${holder}${holder_cmd:+ (${holder_cmd})}.

That is almost always a dev:local you started in another terminal. Either:

  kill ${holder}            # stop it and run this again
  WAKA_LOCAL_PORT=3011 pnpm dev:local   # or leave it and use another port

If you use another port, open the browser there too — the OAuth callback
follows this value, so http://localhost:${PORT} would answer from the old one.
MSG
    exit 1
  fi
fi
export PUBLIC_API_URL="$local_origin"
export PUBLIC_WEB_URL="$local_origin"
export VITE_API_URL=""
export WAKA_SERVE_WEB_DIST=1
export WAKA_WEB_DIST_DIR="$web_dist_dir"

if [[ "${WAKA_DEV_LOCAL_DRY_RUN:-}" == "1" ]]; then
  if [[ "$WAKA_API_DOTENV_PATH" != "$repo_root/.env.local" ]]; then
    echo "dev:local dry run failed: API dotenv path is not repo-root .env.local" >&2
    exit 1
  fi

  if [[ "$PUBLIC_API_URL" != "$local_origin" ]] || [[ "$PUBLIC_WEB_URL" != "$local_origin" ]]; then
    echo "dev:local dry run failed: local API and web URLs must both use $local_origin" >&2
    exit 1
  fi

  if [[ -n "$VITE_API_URL" ]]; then
    echo "dev:local dry run failed: VITE_API_URL must be empty so the built client uses same-origin API paths" >&2
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
echo "  Browser: $local_origin"
echo "Building web app for same-origin API paths..."

pnpm --filter @waka/web build

# THE BUILD KEEPS ITSELF CURRENT FROM HERE.
#
# This server serves packages/web/dist off disk and never looks at the source
# again, so before this every web edit needed a manual `pnpm --filter
# @waka/web build` before a reload showed anything. That is a silent failure:
# the page loads, it just isn't your code, and you debug the previous version
# while reading the current one. It cost real time twice in one session.
#
# `vite build --watch` recompiles dist on every save. The server keeps reading
# from disk, so a browser reload is now always the current code — the same
# guarantee the Vite dev server gives, without giving up the single-origin
# setup that makes cookies and OAuth work here.
#
# Set WAKA_NO_WATCH=1 to opt out (a one-off build, then no rebuilding).
if [[ "${WAKA_NO_WATCH:-}" != "1" ]]; then
  echo "  Watching packages/web for changes (WAKA_NO_WATCH=1 to disable)"
  pnpm --filter @waka/web exec vite build --watch --logLevel warn &
  watch_pid=$!
fi

echo "Starting monolithic local server. Press Ctrl+C to stop."

pnpm --filter @waka/api exec tsx src/server.ts &
api_pid=$!

wait "$api_pid"
