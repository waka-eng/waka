/**
 * THE TWO DATABASES `fresh-migrate.db.test.ts` NEEDS, MADE AND REMOVED WHILE
 * THE CLUSTER IS QUIET.
 *
 * Every other suite isolates with a SCHEMA (`test/helpers/db.ts`): cheap,
 * namespaced by `search_path`, droppable in one statement. `fresh-migrate`
 * cannot — it exists to run drizzle's own migrator from nothing and that
 * migrator only targets `public` — so it needs two real databases.
 *
 * WHY THAT MADE IT FLAKY. `CREATE DATABASE` and `DROP DATABASE` are
 * cluster-wide: a template copy, a directory removal, a checkpoint. They do
 * not scale with concurrency, they CONTEND with it. Measured on a 10-core
 * machine against local Postgres 17, with the full api suite running:
 *
 *     idle:            CREATE + DROP = 0.25s
 *     under the suite: CREATE + DROP = 14.4s, 21.1s, 25.4s
 *
 * The file reported `FAIL` beside `1660 passed, 0 failed` — a file-level
 * failure with no failing assertion, which teaches people to rerun CI
 * instead of reading it. Raising the hook timeout (45s -> 60s) only moved
 * the number; the deadline depends on what the other 170 files are doing.
 *
 * So both statements run here instead: once before any worker starts, once
 * after every worker has stopped, against an idle cluster, in well under a
 * second each. The test file issues no `CREATE`/`DROP DATABASE` of its own
 * — it runs plenty of DDL, since the migrator it exercises is nothing else.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────
 *
 * AN EARLIER VERSION SWEPT BY PREFIX: at startup it dropped every database
 * matching `waka_freshmig_%` and every schema matching `waka_test_%`, to
 * reap what crashed runs leave behind. Review proved three things wrong
 * with that, and they are recorded because the idea is tempting enough to
 * be reinvented:
 *
 *   1. TWO CONCURRENT RUNS DESTROYED EACH OTHER. A pattern has no notion of
 *      ownership, so run B's startup dropped run A's live databases and its
 *      in-flight schemas CASCADE. Run A then failed across ~170 files with
 *      "relation does not exist" — the exact product-looking flake this
 *      change exists to remove, at a larger scale.
 *   2. IT WAS SQL-INJECTABLE, and provably so: a schema named
 *      `waka_test_z"; CREATE TABLE …; --` had its payload executed, because
 *      a name read from `pg_namespace` was interpolated into `unsafe()`
 *      without doubling embedded quotes. `test/helpers/db.ts` already
 *      guards this exact slot with `sanitizeSchemaName`.
 *   3. `LIKE 'waka_freshmig_%'` TREATS `_` AS A WILDCARD. It dropped a
 *      database called `wakaXfreshmigY_important`.
 *
 * This version creates two names it generated itself and drops those two by
 * exact name. It reads no catalog, matches no pattern, and cannot touch a
 * database it did not make. The cost is that a run killed with ^C leaves
 * its two databases behind; `fresh-migrate`'s own names are distinctive and
 * a human can drop them. That is a smaller problem than deleting a
 * colleague's running suite.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseDotenv } from "dotenv";
import postgres from "postgres";
import type { GlobalSetupContext } from "vitest/node";

const stamp = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Generated here, never read back from a catalogue: `[a-z0-9_]` by construction. */
const FRESH_DB = `waka_freshmig_${stamp()}`;
const STUCK_DB = `waka_stuckmig_${stamp()}`;

/**
 * IT READS THE ENV FILE WITHOUT TOUCHING `process.env`, and that restraint
 * is the point rather than a style choice.
 *
 * `globalSetup` runs in the vitest PARENT, before any worker. An earlier
 * version called `dotenv.config({ override: true })` here, which mutated
 * the parent's environment — and workers inherit it. That silently beat an
 * explicitly exported `DB_CONNECTION_URL`, defeating the boundary
 * `test/setup.ts` documents in as many words: "a command that points at a
 * disposable local test database must never be silently redirected to the
 * developer database in `.env.local`." Proven with a minimal repro: a
 * shell-exported value lost to the one globalSetup had set.
 *
 * So the file is PARSED and the value used locally. An explicit
 * `process.env.DB_CONNECTION_URL` always wins, exactly as it does for the
 * workers. First directory containing an env file wins, matching
 * `setup.ts`'s walk rather than letting an outer `~/.env.local` override an
 * inner one.
 */
function connectionString(): string {
  /* `DB_CONNECTION_URL` ONLY, DELIBERATELY, even though the rest of the
     codebase accepts `DATABASE_URL` as a fallback. `test/setup.ts` reads
     this one variable and judges this one variable, and a provisioner that
     vets a DIFFERENT url from the one the suite will actually use is a
     guard over nothing.

     Proven before this line said so: with `DATABASE_URL` exported to a
     production-shaped url and `DB_CONNECTION_URL` only in `.env.local`,
     the provisioner vetted the production url, refused to provision, and
     announced that `test/setup.ts` would refuse the run — which it did
     not, because it read the disposable url from `.env.local` and was
     satisfied. The suite then failed with
     `database "waka_freshmig_…" does not exist`, the exact opaque symptom
     this file exists to prevent. Tooling that exports `DATABASE_URL`
     (Prisma, Neon, Supabase) is common enough for that to be a Tuesday. */
  const explicit = process.env.DB_CONNECTION_URL;
  if (explicit) return explicit;

  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const layered: Record<string, string> = {};
    let found = false;
    for (const name of [".env", ".env.local"]) {
      const candidate = resolve(cursor, name);
      if (!existsSync(candidate)) continue;
      found = true;
      Object.assign(layered, parseDotenv(readFileSync(candidate)));
    }
    if (found) return layered.DB_CONNECTION_URL ?? "";
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return "";
}

/**
 * THE SAME TEST `test/setup.ts` APPLIES, APPLIED EARLIER.
 *
 * `assertDisposableTestDatabase` is a `setupFiles` entry, so it runs inside
 * the workers — AFTER this. Provisioning that did not check for itself
 * would therefore `CREATE`/`DROP DATABASE` against whatever the URL names
 * and only then be told to stop. Kept deliberately identical to
 * `isClearlyDisposableTestDatabase`: loopback host, and "test" in the
 * database or schema name.
 */
function isDisposable(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const database = parsed.pathname.replace(/^\//, "").toLowerCase();
    const schema = parsed.searchParams.get("schema")?.toLowerCase() ?? "";
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
    return local && (database.includes("test") || schema.includes("test"));
  } catch {
    return false;
  }
}

let explained = false;

async function withAdmin(run: (sql: postgres.Sql) => Promise<void>): Promise<boolean> {
  const url = connectionString();
  if (!url) return false;
  if (!isDisposable(url) && process.env.WAKA_ALLOW_TEST_SCHEMA_DDL !== "1") {
    /* Once per run, not once per hook: `setup` and `teardown` both arrive
       here and the same paragraph twice reads like two different faults. */
    if (explained) return false;
    explained = true;
    console.log(
      "[db-provision] DB_CONNECTION_URL does not look like a local disposable test " +
        "database, so the two migration databases were NOT created. This reads the " +
        "same variable and applies the same test as `test/setup.ts`, which will now " +
        "refuse the run with the full explanation.",
    );
    return false;
  }
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await run(admin);
    return true;
  } finally {
    /* `{ timeout }`: a bare `end()` waits on anything still in flight, which
       is the whole problem this file exists to avoid. */
    await admin.end({ timeout: 10 }).catch(() => {});
  }
}

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  /* NOT SWALLOWED. An earlier version caught provisioning errors and logged
     them, so a denied CREATE surfaced 80 seconds later as the migrator
     failing on `CREATE SCHEMA "drizzle"` — a message about nothing, in a
     file that had done nothing wrong. A failure here should stop the run
     here, where the cause is still on screen. */
  await withAdmin(async (admin) => {
    for (const name of [FRESH_DB, STUCK_DB]) {
      await admin.unsafe(`CREATE DATABASE "${name}"`);
    }
  });
  provide("freshMigrateDb", FRESH_DB);
  provide("stuckMigrateDb", STUCK_DB);
}

export async function teardown(): Promise<void> {
  await withAdmin(async (admin) => {
    for (const name of [FRESH_DB, STUCK_DB]) {
      /* BY EXACT NAME, and only the two this run made. No catalogue read,
         no pattern, nothing of anyone else's within reach. `IF EXISTS`
         because a failed `setup` leaves nothing to drop; `FORCE` because a
         worker killed mid-test can leave a connection open to it. */
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
}
