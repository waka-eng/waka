/**
 * A BRAND-NEW DATABASE CAN BE MIGRATED.
 *
 * This is the path nobody runs twice: the first `pnpm db:migrate` on an empty
 * database — a new developer, a new environment, CI. It broke on 2026-08-24
 * and no gate noticed, because every database anyone was using had already
 * been migrated, and the test harness replays the SQL files itself rather
 * than going through the migrator.
 *
 * WHAT BROKE, because the shape of it will recur. drizzle applies every
 * pending migration inside ONE transaction. PostgreSQL refuses to use an enum
 * value that was ADDED earlier in the same uncommitted transaction — so 0024
 * adding 'group' and 0025 naming it in a CHECK were individually correct and
 * jointly fatal on any database where both were pending. Fixed by naming the
 * value in the baseline CREATE TYPE, since a value of a type CREATED in the
 * transaction is usable at once.
 *
 * The general rule this case exists to enforce: no migration may USE an enum
 * value that another unapplied migration ADDS. Reading the SQL cannot prove
 * that — only running the real migrator against a real empty database can.
 *
 * WHAT THIS MOCKS, AND WHY: nothing, and it deliberately does not use the
 * shared test-schema helper. That helper replays the migration files by hand
 * into a schema, which is exactly the thing that hid this bug; this case
 * calls drizzle's own migrator against a database it creates and drops.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** `waka_freshmig_<random>` — created here, dropped in afterAll. */
const DATABASE = `waka_freshmig_${Math.random().toString(36).slice(2, 10)}`;

function migrationsFolder(): string {
  let cursor = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(cursor, "drizzle/migrations");
    if (existsSync(candidate)) return candidate;
    cursor = resolve(cursor, "..");
  }
  throw new Error("could not find drizzle/migrations");
}

const url = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL ?? "";
/** The admin connection creates and drops; it must not be the target itself. */
let admin: postgres.Sql | undefined;
let freshUrl = "";

describe("the first migration on an empty database", () => {
  beforeAll(async () => {
    admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${DATABASE}"`);
    freshUrl = url.replace(/\/[^/?]+(\?|$)/, `/${DATABASE}$1`);
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  });

  it("applies the whole corpus through drizzle's own migrator, in one run", async () => {
    const sql = postgres(freshUrl, { max: 1, onnotice: () => {} });
    try {
      /* The assertion IS this call. It throws on the first statement the
         migrator cannot apply, and the message names it. */
      await migrate(drizzle(sql), { migrationsFolder: migrationsFolder() });

      /* And the corpus really landed, rather than the migrator finding
         nothing to do and reporting success. */
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`;
      expect(Number(count), "every migration in the folder is recorded").toBeGreaterThan(20);

      /* The three facts the failure was about, checked directly: the enum
         carries the room's kind, evidence carries the memory's owner, and the
         mind's shape is pinned. */
      const labels = await sql<{ label: string }[]>`
        SELECT unnest(enum_range(NULL::profile_type))::text AS label`;
      expect(labels.map((r) => r.label)).toContain("group");

      const columns = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'signal_evidence' AND column_name = 'owner_profile_id'`;
      expect(columns, "signal_evidence carries the evidence owner").toHaveLength(1);

      const checks = await sql<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conname = 'profiles_mind_shape_check'`;
      expect(checks, "the mind's shape is pinned").toHaveLength(1);
    } finally {
      await sql.end();
    }
  }, 180_000);
});
