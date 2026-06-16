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
 * Guardrails before schema setup
 * ------------------------------
 * The full API suite may create/update test-only schema prerequisites before
 * route specs hit the production-style getDb(). To protect developer and
 * remote databases, setup refuses DB_CONNECTION_URL values that do not look
 * like local disposable test databases unless the runner explicitly sets
 * WAKA_ALLOW_TEST_SCHEMA_DDL=1 after confirming the target is safe.
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
  // `override: false` on the base load still honours any value already
  // exported into the shell; the explicit `override: true` on `.env.local`
  // lets a developer's local config win over both the shell and `.env`.
  const baseEnv = resolve(rootDir, ".env");
  if (existsSync(baseEnv)) loadDotenv({ path: baseEnv });
  const localEnv = resolve(rootDir, ".env.local");
  if (existsSync(localEnv)) loadDotenv({ path: localEnv, override: true });
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
        CREATE TYPE "public"."signal_revisit_event_type" AS ENUM(
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
      CREATE TABLE IF NOT EXISTS "public"."signal_revisit_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL,
        "signal_id" uuid NOT NULL,
        "event_type" "public"."signal_revisit_event_type" NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."signal_revisit_events"
          ADD CONSTRAINT "signal_revisit_events_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."signal_revisit_events"
          ADD CONSTRAINT "signal_revisit_events_signal_id_signals_id_fk"
          FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "signal_revisit_events_signal_created_idx"
        ON "public"."signal_revisit_events"
        USING btree ("user_id", "signal_id", "created_at" DESC NULLS LAST);
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "signal_revisit_events_user_created_idx"
        ON "public"."signal_revisit_events"
        USING btree ("user_id", "created_at" DESC NULLS LAST);
    `);
  } finally {
    await sql
      .unsafe(`SELECT pg_advisory_unlock(hashtext('waka_test_revisit_event_schema'))`)
      .catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function ensureLocalePreferenceSchema(): Promise<void> {
  const connectionString = process.env.DB_CONNECTION_URL;
  if (!connectionString) return;

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    await sql.unsafe(
      `SELECT pg_advisory_lock(hashtext('waka_test_locale_preference_schema'))`,
    );
    await sql.unsafe(`
      ALTER TABLE "public"."users"
        ADD COLUMN IF NOT EXISTS "preferred_locale" text NOT NULL DEFAULT 'en-US';
    `);
    await sql.unsafe(`
      ALTER TABLE "public"."top_of_mind_notes"
        ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en-US';
    `);
  } finally {
    await sql
      .unsafe(`SELECT pg_advisory_unlock(hashtext('waka_test_locale_preference_schema'))`)
      .catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function ensureMeaningPacketSchema(): Promise<void> {
  const connectionString = process.env.DB_CONNECTION_URL;
  if (!connectionString) return;

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    await sql.unsafe(
      `SELECT pg_advisory_lock(hashtext('waka_test_meaning_packet_schema'))`,
    );
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "public"."signal_packets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" uuid NOT NULL,
        "signal_id" uuid NOT NULL,
        "primary_spark_id" uuid,
        "spark_text" text DEFAULT '' NOT NULL,
        "artifact_excerpt" text DEFAULT '' NOT NULL,
        "packet_text" text NOT NULL,
        "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "classifier_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "input_fingerprint" text NOT NULL,
        "token_estimate" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."signal_packets"
          ADD CONSTRAINT "signal_packets_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."signal_packets"
          ADD CONSTRAINT "signal_packets_signal_id_signals_id_fk"
          FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."signal_packets"
          ADD CONSTRAINT "signal_packets_primary_spark_id_signal_sparks_id_fk"
          FOREIGN KEY ("primary_spark_id") REFERENCES "public"."signal_sparks"("id")
          ON DELETE set null ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "signal_packets_user_signal_unique_idx"
        ON "public"."signal_packets" ("user_id", "signal_id");
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "signal_packets_user_updated_idx"
        ON "public"."signal_packets" ("user_id", "updated_at" DESC);
    `);
  } finally {
    await sql
      .unsafe(`SELECT pg_advisory_unlock(hashtext('waka_test_meaning_packet_schema'))`)
      .catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function ensureDocumentsSchema(): Promise<void> {
  const connectionString = process.env.DB_CONNECTION_URL;
  if (!connectionString) return;

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    await sql.unsafe(
      `SELECT pg_advisory_lock(hashtext('waka_test_documents_schema'))`,
    );
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "public"."document_type" AS ENUM(
          'signal',
          'top_of_mind_note',
          'context_node',
          'context_edge'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "public"."documents" (
        "id" uuid PRIMARY KEY NOT NULL,
        "user_id" uuid NOT NULL,
        "doc_type" "public"."document_type" NOT NULL,
        "path" text NOT NULL,
        "content_hash" text NOT NULL,
        "rev" integer DEFAULT 1 NOT NULL,
        "search_text" text,
        "cluster" "public"."cluster",
        "importance_score" integer,
        "wow_score" integer,
        "created_at" timestamp with time zone,
        "indexed_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "public"."documents"
          ADD CONSTRAINT "documents_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "documents_user_path_unique_idx"
        ON "public"."documents" ("user_id", "path");
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "documents_user_type_created_idx"
        ON "public"."documents" ("user_id", "doc_type", "created_at" DESC NULLS LAST);
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS "documents_user_type_score_idx"
        ON "public"."documents" ("user_id", "doc_type", "wow_score" DESC NULLS LAST);
    `);
  } finally {
    await sql
      .unsafe(`SELECT pg_advisory_unlock(hashtext('waka_test_documents_schema'))`)
      .catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

await ensureRevisitEventSchema();
await ensureLocalePreferenceSchema();
await ensureMeaningPacketSchema();
await ensureDocumentsSchema();
