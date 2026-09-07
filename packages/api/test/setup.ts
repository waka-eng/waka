/**
 * Vitest global setup.
 *
 * Responsibilities (in order):
 *
 *   1. Load `.env` from the repo root so DB_CONNECTION_URL, AUTH_SECRET,
 *      JWT_SECRET, AUTH_GOOGLE_*, GEMINI_API_KEY (etc.) are available to any
 *      module that reads `process.env` at import time. We deliberately do
 *      this BEFORE any other test file imports anything from `src/` — a
 *      module-eval-time read of `JWT_SECRET` (e.g. by a future helper that
 *      pre-builds a signing key) would otherwise see `undefined`.
 *
 *   2. Tripwire: assert the secrets the auth surface needs are actually
 *      populated. The Hono signup/login handler throws "JWT_SECRET is not
 *      set" deep in the call stack if this is missing, which surfaces as
 *      a confusing test failure ("expected 201, got 500"). Failing here
 *      with a clear message saves a debugging round-trip.
 *
 *   3. Pin `NODE_ENV=test` so the production-only branches (Secure cookie,
 *      production logging) stay off during the suite.
 *
 * Why dotenv at the top of this file (rather than per-test)?
 * ---------------------------------------------------------
 * `vitest.config.ts` lists this file under `setupFiles`, which Vitest runs
 * once per worker BEFORE collecting/executing any test file. That gives
 * us the strongest possible "load .env before SUT imports" guarantee
 * without sprinkling `dotenv/config` into every spec.
 *
 * Guardrails
 * ----------
 * Route specs write real rows through the production-style getDb() and reap
 * them afterwards. To protect developer and remote databases, setup refuses
 * DB_CONNECTION_URL values that do not look like local disposable test
 * databases unless the runner explicitly sets WAKA_ALLOW_TEST_SCHEMA_DDL=1
 * after confirming the target is safe.
 *
 * What setup deliberately does NOT do is patch the schema. The migration
 * corpus is one baseline file and `drizzle-kit migrate` is the only thing
 * that applies it — a test run that finds a table missing is telling the
 * truth about the database it was pointed at, and papering over that here
 * is how a suite ends up green against a schema nothing else has.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

// ---------------------------------------------------------------------------
// 1. Load .env from the repo root.
// ---------------------------------------------------------------------------

/**
 * Walk up from this file looking for the repo-root `.env`. Doing it
 * dynamically — rather than hard-coding a `../../../.env` relative path —
 * keeps the helper resilient to future moves of the api package within the
 * monorepo.
 */
function findRepoEnvFile(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  let cursor = here;
  for (let i = 0; i < 8; i++) {
    const envCandidate = resolve(cursor, ".env");
    if (existsSync(envCandidate)) return envCandidate;
    const localEnvCandidate = resolve(cursor, ".env.local");
    if (existsSync(localEnvCandidate)) return localEnvCandidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

const envFile = findRepoEnvFile();
if (envFile) {
  const rootDir = dirname(envFile);
  // Layer env files the standard way: `.env` provides base values, then
  // `.env.local` overrides them. The repo-root `.env` ships placeholder
  // connection details (e.g. HOST.neon.tech), while a developer's real
  // DB_CONNECTION_URL lives in `.env.local` — loading only `.env` (its
  // default search order) made the whole suite fail at import with a DNS
  // error against the placeholder host.
  //
  // `.env.local` overrides repository placeholders, while values explicitly
  // exported by the runner remain authoritative. The latter is a safety
  // boundary: a command that points at a disposable local test database must
  // never be silently redirected to the developer database in `.env.local`.
  const explicitEnvironment = { ...process.env };
  const baseEnv = resolve(rootDir, ".env");
  if (existsSync(baseEnv)) loadDotenv({ path: baseEnv });
  const localEnv = resolve(rootDir, ".env.local");
  if (existsSync(localEnv)) loadDotenv({ path: localEnv, override: true });
  Object.assign(process.env, explicitEnvironment);
}

/**
 * HERMETIC BY DEFAULT: the layering above pulls the developer's real model
 * keys out of `.env.local`, and the live benches (judge, extraction,
 * pipeline) key off nothing but the keys' presence — so a plain
 * `pnpm test` was quietly running live evals and spending real model calls
 * on every full-suite run, for as long as the keys have been in that file.
 * Discovered 2026-08-31 when a bad provider day made the silent spend
 * visible as three bench failures inside a "hermetic" run.
 *
 * The benches are real and wanted — under the `eval:*` scripts and CI's
 * credentialed step, which set this flag. Everything else runs modelless.
 */
if (process.env.WAKA_RUN_LIVE_EVALS !== "1") {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
}

// ---------------------------------------------------------------------------
// 2. Tripwire — fail loudly when required secrets are missing.
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  "DB_CONNECTION_URL",
  // Either AUTH_SECRET or JWT_SECRET is acceptable — the auth helper
  // reads JWT_SECRET first and falls back to AUTH_SECRET. We require at
  // least one rather than both so the tripwire matches the production
  // resolver's contract exactly.
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(
      `[test/setup] Required env var ${key} is not set. ` +
        `Configure a disposable migrated test database in .env.local before running the full API test suite, ` +
        `or use \`pnpm --filter @waka/api test:unit\` for unit tests that do not need a database.`,
    );
  }
}

function isClearlyDisposableTestDatabase(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    const database = url.pathname.replace(/^\//, "").toLowerCase();
    const schema = url.searchParams.get("schema")?.toLowerCase() ?? "";
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return isLocal && (database.includes("test") || schema.includes("test"));
  } catch {
    return false;
  }
}

function assertDisposableTestDatabase(): void {
  const connectionString = process.env.DB_CONNECTION_URL;
  if (!connectionString) return;
  if (process.env.WAKA_ALLOW_TEST_SCHEMA_DDL === "1") return;
  if (isClearlyDisposableTestDatabase(connectionString)) return;

  throw new Error(
    "[test/setup] Refusing to run full API tests against DB_CONNECTION_URL because it does not look like a local disposable test database. " +
      "The full suite creates/updates test-only schema prerequisites. Point DB_CONNECTION_URL at a migrated local test database whose database or schema name contains 'test', " +
      "or set WAKA_ALLOW_TEST_SCHEMA_DDL=1 only after confirming the target is disposable. " +
      "For pure unit coverage, run `pnpm --filter @waka/api test:unit` instead.",
  );
}

assertDisposableTestDatabase();

if (!process.env.JWT_SECRET && !process.env.AUTH_SECRET) {
  throw new Error(
    "[test/setup] Neither JWT_SECRET nor AUTH_SECRET is set. " +
      "The session signer needs one of these to mint tokens during tests.",
  );
}

// ---------------------------------------------------------------------------
// 3. Pin NODE_ENV.
// ---------------------------------------------------------------------------

// Don't clobber a deliberate override (e.g. running the suite with
// NODE_ENV=production to verify Secure-cookie behaviour).
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}
