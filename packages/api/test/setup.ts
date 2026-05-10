/**
 * Vitest global setup.
 *
 * Responsibilities (in order):
 *
 *   1. Load local env from the repo root (`.env`, then `.env.development` as
 *      fallback) so DB_CONNECTION_URL, AUTH_SECRET, JWT_SECRET,
 *      AUTH_GOOGLE_*, GEMINI_API_KEY (etc.) are available to any
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
 * us the strongest possible "load local dotenv before SUT imports" guarantee
 * without sprinkling env-loading imports into every spec.
 *
 * No DB schema isolation here
 * ---------------------------
 * The auth routes go through the production `getDb()` singleton which is
 * bound to the public schema by design (Lambda cold-start path). Schema
 * isolation via `createTestDatabase()` exists for tests that drive Drizzle
 * directly, but for `app.request("/auth/...")` we use unique
 * RFC-6761-reserved emails (`@example.test`) plus per-test cleanup of
 * inserted user rows — see `test/auth.test.ts`. ON DELETE CASCADE on
 * `sessions.user_id` reaps any session rows along with the user.
 */

import { loadLocalEnv } from "../../../tools/local-env/load.js";

// ---------------------------------------------------------------------------
// 1. Load local env from the repo root.
// ---------------------------------------------------------------------------

// Precedence is .env first, then .env.development as fallback. `override:
// false` is applied by the helper so explicit shell exports still win.
loadLocalEnv();

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
        `Configure it in .env or .env.development at the repo root before running the test suite.`,
    );
  }
}

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
