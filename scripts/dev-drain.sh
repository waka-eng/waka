#!/usr/bin/env bash
# The local stand-in for the queue worker the cloud invokes for you.
#
# Loads `.env.local` exactly the way `dev-local.sh` does — same file, same
# precedence, so the drain talks to the same database and uses the same model
# key as the server beside it — then runs the drain loop.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env.local"
export WAKA_API_DOTENV_PATH="$env_file"

if [[ -f "$env_file" ]]; then
  exports="$(ENV_FILE="$env_file" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

const parsed = parse(readFileSync(process.env.ENV_FILE));

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

for (const [key, value] of Object.entries(parsed)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    console.error(`Invalid environment variable name in .env.local: ${key}`);
    process.exitCode = 1;
    continue;
  }
  if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
  console.log(`export ${key}=${shellQuote(value)}`);
}
NODE
)"
  [[ -n "$exports" ]] && eval "$exports"
else
  echo "Warning: $env_file not found; continuing with existing environment only." >&2
fi

if [[ -z "${DB_CONNECTION_URL:-}${DATABASE_URL:-}" ]]; then
  echo "No DB_CONNECTION_URL / DATABASE_URL — the drain has no queue to read." >&2
  exit 1
fi

exec pnpm exec tsx "$repo_root/tools/dev-stack/drain.ts"
