#!/usr/bin/env bash
set -euo pipefail

api_pid=""
watch_pid=""
nightly_pid=""
s3_stub_pid=""
# Declared up here with the pids, not beside the block that fills them in:
# `cleanup` runs on every exit path, including ones taken before that block
# (a missing .env.local, a port already held), and under `set -u` an unset
# variable read inside a trap is an error the trap then cannot report.
local_s3=0
s3_stub_port=""
s3_stub_dir=""
shutting_down=0
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web_dist_dir="$repo_root/packages/web/dist"

load_env_local() {
  local env_file="$repo_root/.env.local"

  export WAKA_API_DOTENV_PATH="$env_file"

  # NOT FATAL, ON PURPOSE: CI boots this stack with the variables exported
  # inline and no file on disk (.github/workflows/ci.yml, "Boot the local
  # stack"). But a developer who hits this is usually one command from a
  # working stack and has no way to know which one, so the warning names it
  # rather than describing the situation.
  if [[ ! -f "$env_file" ]]; then
    echo "Warning: $env_file not found; continuing with existing environment only." >&2
    if [[ -z "${DB_CONNECTION_URL:-}${DATABASE_URL:-}" ]]; then
      echo "  No DB_CONNECTION_URL in the environment either, so the API will" >&2
      echo "  start and then fail on its first query. If you meant to run" >&2
      echo "  locally:  cp .env.example .env.local  and fill in DB_CONNECTION_URL." >&2
    fi
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

  if [[ -n "$nightly_pid" ]] && kill -0 "$nightly_pid" 2>/dev/null; then
    kill "$nightly_pid" 2>/dev/null || true
  fi

  if [[ -n "$s3_stub_pid" ]] && kill -0 "$s3_stub_pid" 2>/dev/null; then
    kill "$s3_stub_pid" 2>/dev/null || true
  fi

  # AND THEN BY NAME, because a surviving store is worse than a surviving
  # anything else here: the next `pnpm dev:local` finds its port taken and
  # refuses to start at all. Ctrl+C reaches the whole process group and this
  # matches nothing; a `kill <script pid>` from a tool or a parent script does
  # not, and leaves the node process orphaned behind the runner we signalled.
  # The pattern carries this stack's own port, so a second stack is untouched.
  if [[ -n "$s3_stub_port" ]] && command -v pkill >/dev/null 2>&1; then
    pkill -f "s3-stub.ts --port ${s3_stub_port} --dir" 2>/dev/null || true
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

# PHOTOS OF INSPIRING MOMENTS, ON A MACHINE WITH NO AWS ACCOUNT.
#
# The founder asked for this twice — share the photo of the moment, and say
# why the moment felt inspiring as it goes up — and had never once seen it
# work, because `ATTACHMENTS_BUCKET` was unset here. `getAttachmentsBucket()`
# throws when it is, so `POST /api/attachments/presign` answered 500 and the
# upload never began: the whole feature was unreachable on the only machine
# they use, and nothing in local dev said why. A feature the founder cannot
# exercise is not shipped (docs/six-laws.md, Law 9), and local-dev
# configuration is therefore part of the deliverable, not a note in a README.
#
# So the stack brings its own object store: `tools/e2e/s3-stub.ts`, which
# already existed for the e2e harnesses and spoke enough S3 for presign → PUT
# → HEAD → GetObject. `ATTACHMENTS_ENDPOINT` is the documented, opt-in seam
# that points `lib/s3-client.ts` at it (path-style, dummy credentials), and
# nothing in `sst.config.ts` sets that variable — so this cannot leak into a
# deployed stage. Objects are written under the repo so that stopping and
# starting the stack does not turn yesterday's photo into a broken image.
#
# TWO ESCAPE HATCHES, IN PRIORITY ORDER:
#   - `ATTACHMENTS_ENDPOINT` already set (in .env.local or the shell) wins and
#     this does nothing — you are pointing at your own store on purpose.
#   - `WAKA_NO_LOCAL_S3=1` uses real AWS: your own `ATTACHMENTS_BUCKET` and
#     whatever credentials the SDK chain finds. Nothing is defaulted for you
#     there, because guessing a bucket name against real S3 fails later and
#     further away.
if [[ "${WAKA_NO_LOCAL_S3:-}" != "1" && -z "${ATTACHMENTS_ENDPOINT:-}" ]]; then
  local_s3=1
  # PORT + 1 by default, so a second stack on another WAKA_LOCAL_PORT brings
  # its own store rather than quietly sharing the first one's objects.
  s3_stub_port="${WAKA_S3_STUB_PORT:-$((PORT + 1))}"
  s3_stub_dir="${WAKA_S3_STUB_DIR:-$repo_root/.waka-attachments-local}"
  export ATTACHMENTS_ENDPOINT="http://127.0.0.1:${s3_stub_port}"
  export ATTACHMENTS_BUCKET="${ATTACHMENTS_BUCKET:-waka-local}"
fi

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

  # ASSERTED, NOT ASSUMED. The variable this exists to set is read far from
  # here — `getAttachmentsBucket()` throws deep inside a route — so a
  # refactor that dropped the two exports above would show up as uploads
  # answering 500 again, which is precisely the failure that went unnoticed
  # for months. `pnpm test:dev-local-script` runs this.
  if [[ "$local_s3" -eq 1 ]]; then
    if [[ -z "${ATTACHMENTS_BUCKET:-}" ]]; then
      echo "dev:local dry run failed: ATTACHMENTS_BUCKET is unset, so uploads would 500" >&2
      exit 1
    fi
    if [[ "${ATTACHMENTS_ENDPOINT:-}" != "http://127.0.0.1:${s3_stub_port}" ]]; then
      echo "dev:local dry run failed: ATTACHMENTS_ENDPOINT does not point at the local object store" >&2
      exit 1
    fi
    if [[ ! -f "$repo_root/tools/e2e/s3-stub.ts" ]]; then
      echo "dev:local dry run failed: the local object store (tools/e2e/s3-stub.ts) is missing" >&2
      exit 1
    fi
  fi

  echo "dev:local dry run ok"
  exit 0
fi

echo "Starting WAKA local dev (Option B monolithic)..."
echo "  Browser: $local_origin"

# SAY WHO HAS THE STORE'S PORT, for the same reason the API's is checked above
# — and refuse rather than continue, because "continued without an object
# store" is indistinguishable from the bug this block exists to end.
if [[ "$local_s3" -eq 1 ]] && command -v lsof >/dev/null 2>&1; then
  stub_holder="$(lsof -ti "tcp:${s3_stub_port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "$stub_holder" ]]; then
    cat >&2 <<MSG
Port ${s3_stub_port} — the local attachments store — is already in use by pid ${stub_holder}.

Photo and voice uploads need it, so this stops here rather than starting a
stack where they 500. Either:

  kill ${stub_holder}                         # stop it and run this again
  WAKA_S3_STUB_PORT=8792 pnpm dev:local  # or put the store somewhere else
  WAKA_NO_LOCAL_S3=1 pnpm dev:local      # or use real S3 and your own bucket
MSG
    exit 1
  fi
fi

if [[ "$local_s3" -eq 1 ]]; then
  echo "  Photos + voice: local object store at $ATTACHMENTS_ENDPOINT, bucket $ATTACHMENTS_BUCKET"
  echo "    objects in ${s3_stub_dir} (WAKA_NO_LOCAL_S3=1 to use real S3 instead)"
  # `tsx` straight from the root bin rather than through `pnpm exec`: one
  # fewer process between this script and the thing it has to be able to stop.
  (cd "$repo_root" && exec node_modules/.bin/tsx tools/e2e/s3-stub.ts --port "$s3_stub_port" --dir "$s3_stub_dir") &
  s3_stub_pid=$!
fi

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

if [[ "${WAKA_NO_WATCH:-}" == "1" ]]; then
  pnpm --filter @waka/api exec tsx src/server.ts &
else
  pnpm --filter @waka/api exec tsx watch src/server.ts &
fi
api_pid=$!

# THE CLOCK THE CLOUD HAS AND THIS STACK DID NOT. Deployed stages run the
# PrincipleRefresh cron nightly; locally nothing ever fired it, so the sky
# and the gardener only moved when someone ran the pass by hand. One firing
# per boot is the honest local cadence: idempotency keys (day / ISO week)
# collapse repeats, the cheap gates answer "not yet" for free on an
# ordinary day, and a stack left running across midnight is what the real
# cron exists for anyway. WAKA_NO_NIGHTLY=1 skips it.
if [[ "${WAKA_NO_NIGHTLY:-}" != "1" ]]; then
  (
    sleep 5
    echo "  Principles + garden: hourly recovery pass (WAKA_NO_NIGHTLY=1 to skip)"
    exec pnpm --filter @waka/api nightly --watch
  ) &
  nightly_pid=$!
fi

wait "$api_pid"
