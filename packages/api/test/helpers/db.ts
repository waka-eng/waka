/**
 * Test-database lifecycle helpers.
 *
 * Why this exists
 * ---------------
 * The Seed contract pins persistence to the existing Neon Postgres database
 * referenced by DB_CONNECTION_URL — we are *not* allowed to provision a new
 * one for tests. At the same time, the vitest suite cannot run against the
 * shared `public` schema because:
 *
 *   1. Tests must be hermetic. A failed test cleanup would leave rows
 *      visible to the dev / sst-dev session sharing the same Neon URL.
 *   2. Tests must be safely parallelizable. Two test files truncating
 *      `public.accounts` simultaneously would hand each other empty tables
 *      mid-run.
 *   3. CI re-runs need a clean slate every invocation, with no
 *      cross-pipeline contamination.
 *
 * Solution: per-suite Postgres SCHEMA isolation. Each call to
 * `createTestDatabase()`:
 *
 *   - Creates a fresh schema named `waka_test_<random>` on the live Neon DB.
 *   - Opens a postgres-js connection whose `search_path` is pinned to that
 *     schema (so `accounts`, `inspirations`, etc. unqualified references all
 *     resolve to the test schema, and the production `lib/db.ts` queries —
 *     which never qualify with a schema name — would also work if pointed
 *     at this connection by an integration test).
 *   - Replays the migration corpus into the fresh schema by reading the SQL
 *     files on disk and rewriting hard-coded `"public"` identifiers to the
 *     test schema. The corpus is one baseline file, so a test schema is the
 *     shape of `drizzle/migrations/0000_three_layers.sql` and nothing else.
 *     This avoids depending on drizzle-orm/postgres-js's `migrate()` (which
 *     does not support a target schema other than `public`) while keeping the
 *     migration corpus the single source of truth — no duplicated DDL.
 *   - Returns a Drizzle client bound to that connection, plus a `cleanup`
 *     function that drops the schema CASCADE and closes the connection.
 *
 * Why schemas instead of separate databases? Neon's free/managed tier does
 * not allow ad-hoc CREATE DATABASE from a connection (and the pooler
 * endpoint outright forbids it). Schemas are cheap, isolated by
 * `search_path`, and droppable in one statement.
 *
 * Why not transaction-per-test rollback? The system-under-test fans out
 * across multiple connections (Hono handler invocations may open their own
 * Drizzle clients), and a queue worker handler runs in its own process in
 * production. Transaction-rollback isolation only works when *every* writer
 * shares one connection — which we cannot guarantee here without crippling
 * the architecture. Schema-per-suite + truncate-between-tests is the
 * coarser-but-correct trade-off.
 *
 * Usage (in a vitest spec)
 * ------------------------
 *
 *   import { afterAll, beforeAll, beforeEach, describe } from "vitest";
 *   import { createTestDatabase, type TestDatabase } from "./helpers/db";
 *
 *   let testDb: TestDatabase;
 *
 *   beforeAll(async () => { testDb = await createTestDatabase(); });
 *   afterAll(async () => { await testDb.cleanup(); });
 *   beforeEach(async () => { await testDb.truncateAll(); });
 *
 *   describe("inspirations", () => {
 *     it("inserts a row", async () => {
 *       const [row] = await testDb.db
 *         .insert(inspirations)
 *         .values({ profileId, text: "hi" })
 *         .returning();
 *       expect(row).toBeDefined();
 *     });
 *   });
 */

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "../../src/db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Handle returned by `createTestDatabase`. Owns its connection and schema —
 * always pair with `cleanup()` in an `afterAll` to avoid leaking schemas on
 * the shared Neon database.
 */
export interface TestDatabase {
  /** Random schema name created for this test run, e.g. `waka_test_a1b2c3d4`. */
  readonly schemaName: string;
  /** Drizzle client bound to a connection with `search_path` pinned to `schemaName`. */
  readonly db: PostgresJsDatabase<typeof schema>;
  /** Underlying postgres-js handle, exposed for ad-hoc SQL in tests. */
  readonly sql: Sql;
  /**
   * Truncate every domain table in this test schema, restarting identities
   * and cascading FK deletes. Cheaper than re-running migrations between
   * tests — call from `beforeEach` for a clean slate per test case.
   */
  truncateAll(): Promise<void>;
  /**
   * Drop the test schema (CASCADE) and close the connection. Safe to call
   * more than once; the second call is a no-op. Always invoke from an
   * `afterAll` hook so a failed/aborted suite does not orphan a schema on
   * the shared Neon database.
   */
  cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Schema-name helpers
// ---------------------------------------------------------------------------

/**
 * Postgres identifier rules: lowercase letters, digits, underscores; must not
 * start with a digit; <= 63 bytes. We add a `waka_test_` prefix so a stray
 * orphan is obviously test-owned during human triage on the Neon console,
 * and append 16 hex chars (64 bits of entropy) so concurrent vitest workers
 * never collide.
 */
function generateSchemaName(): string {
  const suffix = randomBytes(8).toString("hex");
  return `waka_test_${suffix}`;
}

/**
 * Defense-in-depth: the schema name we generate is already safe, but we
 * accept an override via `WAKA_TEST_SCHEMA` (useful for debugging — set it,
 * run one test, inspect the schema in Neon Studio). Validate the override so
 * a malicious or typo'd value cannot break out of the identifier slot when
 * we interpolate it into DDL via `client.unsafe()`.
 */
function sanitizeSchemaName(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `Invalid Postgres identifier for test schema: ${JSON.stringify(name)}. ` +
        `Use [a-z_][a-z0-9_]* (<= 63 chars).`,
    );
  }
  return name;
}

// ---------------------------------------------------------------------------
// Connection-string helpers
// ---------------------------------------------------------------------------

function resolveConnectionString(): string {
  const url = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DB_CONNECTION_URL is not set. Tests require the same Neon URL used by " +
        "the runtime — load it via test/setup.ts (dotenv) before importing " +
        "createTestDatabase.",
    );
  }
  return url;
}

function isLocalPostgresUrl(connectionString: string): boolean {
  const { hostname } = new URL(connectionString);
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function resolveSslMode(connectionString: string): false | "require" {
  return isLocalPostgresUrl(connectionString) ? false : "require";
}

function withSearchPath(connectionString: string, searchPath: string): string {
  const url = new URL(connectionString);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${searchPath}`;
  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption,
  );
  return url.toString();
}

function withNeonUnpooledHost(connectionString: string): string {
  const url = new URL(connectionString);
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Migration discovery + application
// ---------------------------------------------------------------------------

/**
 * Walk up from this module to the repo root, looking for `drizzle/migrations`.
 * Doing this dynamically — rather than hard-coding a `../../../../drizzle`
 * relative path — keeps the helper resilient to future moves of the api
 * package within the monorepo.
 */
function findMigrationsDir(): string {
  // Allow an explicit override (e.g. for fixture-based tests that want a
  // pruned migration set). Default behavior: discover at runtime.
  const override = process.env.WAKA_TEST_MIGRATIONS_DIR;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(
        `WAKA_TEST_MIGRATIONS_DIR points at a non-existent path: ${override}`,
      );
    }
    return override;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  let cursor = here;
  // Bound the walk to avoid an infinite loop on misconfiguration.
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(cursor, "drizzle/migrations");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break; // hit filesystem root
    cursor = parent;
  }
  throw new Error(
    `Unable to locate drizzle/migrations starting from ${here}. ` +
      `Set WAKA_TEST_MIGRATIONS_DIR to point at the SQL migration folder.`,
  );
}

/**
 * List the SQL migration files in canonical (lexical) order. drizzle-kit
 * names files with a numeric prefix (`0000_…`, `0001_…`) so a plain string
 * sort matches the order recorded in `meta/_journal.json`. We deliberately
 * do not parse the journal here — the on-disk filename order is the
 * apply-order contract drizzle-kit upholds, and reading both would only add
 * a place for them to disagree.
 *
 * There is one file today. The loop stays because the next migration is the
 * one that would otherwise be silently skipped.
 */
function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Apply every migration in `dir` to the given test schema.
 *
 * The committed migration SQL hard-codes `"public"` in foreign-key
 * references (e.g. `REFERENCES "public"."profiles"("id")`) — that's how
 * drizzle-kit emits them and we keep the SQL files faithful for production
 * use. To redirect those references at the test schema we do a literal
 * string substitution `"public"` → `"<schemaName>"` before executing.
 *
 * This is safe because:
 *   - The migrations are author-controlled and reviewed; no untrusted SQL.
 *   - `"public"` only appears as a quoted schema-qualifier in the generated
 *     output; user data/strings would not contain that token within
 *     identifier quotes.
 *   - The schema name we substitute in is generated by `randomBytes` (or
 *     validated via `sanitizeSchemaName`), so there is no SQL-injection
 *     vector even though we ultimately interpolate it.
 *
 * We split each file on drizzle-kit's `--> statement-breakpoint` marker
 * because postgres-js's `unsafe()` rejects multi-statement strings under
 * pgbouncer in transaction-pooling mode (which is how Neon's pooler is
 * configured).
 */
async function applyMigrations(
  client: Sql,
  schemaName: string,
  migrationsDir: string,
): Promise<void> {
  const files = listMigrationFiles(migrationsDir);
  if (files.length === 0) {
    throw new Error(
      `No .sql migration files found in ${migrationsDir} — refusing to ` +
        `proceed with an empty test schema.`,
    );
  }

  for (const file of files) {
    const path = resolve(migrationsDir, file);
    const raw = readFileSync(path, "utf8");
    // Quoted-identifier substitution only — leaves bare-word "public"
    // appearing inside string literals (none in our migrations today)
    // untouched. The quotes guarantee it's an identifier slot.
    const rewritten = raw.replaceAll('"public"', `"${schemaName}"`);

    const statements = rewritten
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await client.unsafe(statement);
      } catch (err) {
        throw new Error(
          `Failed to apply migration ${file} into schema "${schemaName}".\n` +
            `Statement: ${statement}\n` +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an isolated test database (Postgres schema), apply every committed
 * Drizzle migration to it, and return a handle bound to that schema.
 *
 * The returned handle owns its postgres-js connection — call `cleanup()`
 * (typically from `afterAll`) to drop the schema and release the socket. If
 * a test process exits without calling cleanup, the orphan schema is
 * obvious on the Neon console (`waka_test_<hex>`) and can be reaped with
 * `DROP SCHEMA … CASCADE`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const schemaName = sanitizeSchemaName(
    process.env.WAKA_TEST_SCHEMA?.trim() || generateSchemaName(),
  );

  const connectionString = resolveConnectionString();

  // Neon pooler can run statements across transaction-pooled server sessions,
  // so a plain `SET search_path` is not reliable for a Drizzle client whose
  // queries must always resolve to the isolated schema. We create the schema
  // first, then reconnect through Neon's unpooled host with search_path as a
  // startup option.
  const bootstrapSql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    ssl: resolveSslMode(connectionString),
    onnotice: () => {},
  });

  try {
    await bootstrapSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
  } catch (err) {
    await bootstrapSql.end({ timeout: 5 }).catch(() => {});
    throw err;
  }
  await bootstrapSql.end({ timeout: 5 }).catch(() => {});

  const sql = postgres(
    withSearchPath(withNeonUnpooledHost(connectionString), schemaName),
    {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    ssl: resolveSslMode(connectionString),
    // Don't emit the verbose pgbouncer/Neon notices in test output.
    onnotice: () => {},
    },
  );

  try {
    const migrationsDir = findMigrationsDir();
    await applyMigrations(sql, schemaName, migrationsDir);
  } catch (err) {
    // Best-effort cleanup so a failed setup does not leave a half-built
    // schema on the shared database.
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } catch {
      /* swallow — original error is more interesting */
    }
    await sql.end({ timeout: 5 }).catch(() => {});
    throw err;
  }

  const db = drizzle(sql, { schema });

  /**
   * Every domain table, in dependency order (children → parents). TRUNCATE …
   * RESTART IDENTITY CASCADE handles the FK cascade for us, but listing
   * children first makes the intent obvious to a reader and keeps the
   * statement quick (CASCADE walks fewer constraints).
   *
   * Listing them all — rather than only the roots the rest cascade from —
   * is what makes a missed table a loud failure (`relation does not exist`)
   * the first time the schema and this list disagree, instead of a test that
   * quietly inherits the previous test's rows.
   *
   * We schema-qualify each name explicitly so `truncateAll` works even if
   * a future test mutates `search_path` mid-run.
   */
  const truncatableTables = [
    "feedback",
    "background_jobs",
    "group_top_of_mind_affirmations",
    "group_top_of_mind_proposals",
    "top_of_mind_entry_signals",
    "top_of_mind_entries",
    "top_of_minds",
    "group_membership_events",
    "group_members",
    "groups",
    "signal_shares",
    "signal_evidence",
    "signal_embeddings",
    "signals",
    "inspiration_embeddings",
    "reflections",
    "attachments",
    "inspirations",
    "cli_login_codes",
    "sessions",
    "profiles",
    "accounts",
  ];

  let closed = false;

  const handle: TestDatabase = {
    schemaName,
    db,
    sql,
    async truncateAll() {
      if (closed) {
        throw new Error(
          "truncateAll() called after cleanup() — the test database is gone.",
        );
      }
      const qualified = truncatableTables
        .map((t) => `"${schemaName}"."${t}"`)
        .join(", ");
      await sql.unsafe(
        `TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`,
      );
    },
    async cleanup() {
      if (closed) return;
      closed = true;
      try {
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await sql.end({ timeout: 5 }).catch(() => {});
      }
    },
  };

  return handle;
}
