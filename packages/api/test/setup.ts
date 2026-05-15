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
 * No DB schema isolation here
 * ---------------------------
 * The auth routes go through the production `getDb()` singleton which is
 * bound to the public schema by design (Lambda cold-start path). Schema
 * isolation via `createTestDatabase()` exists for tests that drive Drizzle
 * directly, but for `app.request("/api/auth/...")` we use unique
 * RFC-6761-reserved emails (`@example.test`) plus per-test cleanup of
 * inserted user rows — see `test/api/auth.test.ts`. ON DELETE CASCADE on
 * `sessions.user_id` reaps any session rows along with the user.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

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
    const candidate = resolve(cursor, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

const envFile = findRepoEnvFile();
if (envFile) {
  // `override: false` (default) is correct: if a developer has exported
  // a value into their shell (e.g. `JWT_SECRET=...vitest --filter=...`),
  // we honour the explicit override rather than clobbering it from .env.
  loadDotenv({ path: envFile });
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
        `Configure it in .env at the repo root before running the test suite.`,
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

// ---------------------------------------------------------------------------
// 4. Ensure public-schema test prerequisites added after the last deployed
//    migration exist before route specs hit the production-style getDb().
// ---------------------------------------------------------------------------

async function ensureRevisitEventSchema(): Promise<void> {
  const connectionString = process.env.DB_CONNECTION_URL;
  if (!connectionString) return;

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    await sql.unsafe(
      `SELECT pg_advisory_lock(hashtext('waka_test_revisit_event_schema'))`,
    );
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "public"."inspiration_revisit_event_type" AS ENUM(
          'detail_opened',
          'detail_returned',
          'reflection_created',
          'inspiration_updated'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "public"."inspiration_revisit_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL,
        "inspiration_id" uuid NOT NULL,
        "event_type" "public"."inspiration_revisit_event_type" NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."inspiration_revisit_events"
          ADD CONSTRAINT "inspiration_revisit_events_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."inspiration_revisit_events"
          ADD CONSTRAINT "inspiration_revisit_events_inspiration_id_inspirations_id_fk"
          FOREIGN KEY ("inspiration_id") REFERENCES "public"."inspirations"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "inspiration_revisit_events_inspiration_created_idx"
        ON "public"."inspiration_revisit_events"
        USING btree ("user_id", "inspiration_id", "created_at" DESC NULLS LAST);
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "inspiration_revisit_events_user_created_idx"
        ON "public"."inspiration_revisit_events"
        USING btree ("user_id", "created_at" DESC NULLS LAST);
    `);
  } finally {
    await sql
      .unsafe(`SELECT pg_advisory_unlock(hashtext('waka_test_revisit_event_schema'))`)
      .catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

await ensureRevisitEventSchema();
