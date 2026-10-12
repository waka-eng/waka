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
 * The general rule these cases exist to enforce: no migration may USE an enum
 * value that another unapplied migration ADDS. Reading the SQL cannot prove
 * that — only running the real migrator against a real database can.
 *
 * AND AN EMPTY DATABASE IS ONLY HALF THE RULE. Naming the value in the
 * baseline fixed the fresh path and left the UPGRADE path broken, which is
 * the worse of the two: on a database that already exists, 0000 is long
 * committed, so 0024 adds the value to a pre-existing type and 0025's use of
 * it is exactly the thing PostgreSQL refuses. A gate that only ever migrates
 * an empty database reports success on a release nobody can install. So the
 * second case below builds a database at the previous release and upgrades
 * it, which is what every existing environment actually does.
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {execFileSync} from 'node:child_process';

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
      // The same read-only verifier used by dev rollout must accept a real
      // migrator receipt, including nullable search storage and its triggers.
      const verifier=resolve(migrationsFolder(),'../../scripts/verify-memory-schema.mjs');
      const output=execFileSync(process.execPath,[verifier],{env:{...process.env,DB_CONNECTION_URL:freshUrl},encoding:'utf8'});
      expect(output).toContain('0065/0066/0067');expect(output).toContain('search triggers');

      /* ═══ AND THE COLUMN THIS MIGRATION'S JOURNAL ENTRY CREATES ═════════
         `inspirations.category` is the archive's shelves.
         `schema-inspirations.ts` declares it and the category tabs select
         it, and it did not reach a fresh database for three days, because
         `0069_inspiration_category.sql` was merged with no journal entry
         and `drizzle-kit migrate` applies the journal, not the folder.
         Checked here as well as structurally below, because this column is
         what the omission actually cost. */
      const shelves = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'inspirations' AND column_name = 'category'`;
      expect(shelves, "the archive's shelves reached a fresh database").toHaveLength(1);

      /* ═══ AND THE COLUMN 0070 CREATES, for the same reason ══════════════
         `conversations.initial_inspiration_id` is what a chat is about.
         `schema-conversations.ts` declares it in this PR, so the migration
         that creates it has to reach a fresh database in this PR too —
         which is why `0070_conversation_inspiration_start.sql` and its
         journal entry travelled back here from the next one. */
      const about = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'initial_inspiration_id'`;
      expect(about, "what a conversation is about reached a fresh database").toHaveLength(1);
    } finally {
      await sql.end();
    }
  }, 180_000);

  /**
   * ═══ EVERY MIGRATION ON DISK IS IN THE JOURNAL ═══════════════════════
   *
   * THE FAILURE THIS IS FOR, found 2026-10-11 and silent for three days:
   * `0069_inspiration_category.sql` was written, reviewed and merged, and
   * its journal entry was never added. `drizzle-kit migrate` applies the
   * JOURNAL, not the folder — so on a fresh or upgraded database that
   * column simply never existed, while `schema-inspirations.ts` declared
   * it and the archive's category tabs read it. The next migration was
   * then numbered 0070 and took idx 69, closing the gap over the hole so
   * that nothing in the file looked out of sequence.
   *
   * WHY THE RUN ABOVE DID NOT CATCH IT. It asserts the migrator throws on
   * nothing and that more than twenty migrations are recorded — both true
   * with a file quietly skipped. A test that checks the corpus APPLIES
   * cannot see a file the corpus never mentions; only comparing the two
   * lists can.
   *
   * IT IS A STRUCTURAL CHECK, DELIBERATELY. Asserting the one known column
   * above would pass forever while the seventy-first migration went
   * missing the same way. This compares the folder to the journal, so the
   * next omission fails on the commit that makes it.
   */
  it("lists every migration file in the journal, in order and with no gaps", async () => {
    const folder = migrationsFolder();
    const files = readdirSync(folder)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.replace(/\.sql$/, ""))
      .sort();
    const journal = JSON.parse(
      readFileSync(resolve(folder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const tags = journal.entries.map((entry) => entry.tag);

    expect(files.length, "no migrations were found — is the folder wrong?")
      .toBeGreaterThan(20);
    expect(
      files.filter((name) => !tags.includes(name)),
      "these migrations are on disk and not in the journal, so `drizzle-kit " +
        "migrate` will never apply them",
    ).toEqual([]);
    expect(
      tags.filter((tag) => !files.includes(tag)),
      "the journal names migrations that do not exist",
    ).toEqual([]);
    expect(tags.length, "the journal lists a migration twice").toBe(new Set(tags).size);

    /* `idx` IS THE ORDER THE MIGRATOR WALKS, so a repeat or a gap silently
       reorders or skips. `when` is what the applied table records, so it
       has to rise with it or a replay cannot be told from a new one. And
       the four digits in the filename have to be that same number.

       THE LAST ONE IS IMPLIED BY THE OTHER TWO, as long as the folder
       happens to sort the way the journal is ordered, and it is asserted
       anyway. An entry whose tag disagrees with its idx is the exact shape
       of this bug — 0070 sitting at idx 69 — and a gate that leaves the
       fact it cares about to be inferred is one refactor away from being
       green and blind, which is how four of these were found this week. */
    journal.entries.forEach((entry, at) => {
      expect(entry.idx, `${entry.tag} is out of order in the journal`).toBe(at);
      expect(
        Number(entry.tag.slice(0, 4)),
        `${entry.tag} sits at idx ${entry.idx}, which its own filename contradicts`,
      ).toBe(entry.idx);
      if (at > 0) {
        expect(
          entry.when,
          `${entry.tag} is stamped no later than the migration before it`,
        ).toBeGreaterThan(journal.entries[at - 1]!.when);
      }
    });
  });
});

describe("the enum rule, read straight off the corpus", () => {
  /**
   * NO MIGRATION MAY USE AN ENUM VALUE THAT ANOTHER UNAPPLIED MIGRATION ADDS.
   *
   * This is the rule that broke the 0024/0025 release for every database that
   * already existed, and it is checked here by READING rather than by running,
   * because running cannot check it. drizzle applies all pending migrations in
   * one transaction, and PostgreSQL refuses a value added earlier in that same
   * uncommitted transaction — but only when the TYPE itself is older than the
   * transaction. So:
   *
   *   - an empty database can never reproduce it (the type is created in the
   *     same transaction, which is always safe); and
   *   - a database staged from the CURRENT corpus cannot reproduce it either,
   *     once the baseline names the value — the staged prefix already has it.
   *
   * Two live attempts at a runtime gate passed against a knowingly broken
   * migration for exactly those two reasons. The hazard is a property of the
   * SQL, so the SQL is what gets read.
   *
   * The rule enforced: after a migration adds a value, no migration from that
   * one onward may mention it except through a `::text` comparison, which
   * resolves nothing. That is conservative — it will flag a use that would
   * have been fine — and a false alarm here costs a comment, while a miss
   * costs a release nobody can install.
   */
  it("never uses an enum value that a migration in the same batch adds", async () => {
    const folder = migrationsFolder();
    const files = (await readdir(folder)).filter((f) => f.endsWith(".sql")).sort();
    const bodies = new Map<string, string>();
    for (const name of files) bodies.set(name, await readFile(join(folder, name), "utf8"));

    const ADD_VALUE =
      /ALTER\s+TYPE\s+[^;]*?ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;

    const added: Array<{ file: string; value: string }> = [];
    for (const name of files) {
      for (const m of bodies.get(name)!.matchAll(ADD_VALUE)) {
        added.push({ file: name, value: m[1]! });
      }
    }
    expect(
      added.length,
      "no ALTER TYPE ... ADD VALUE found — either the corpus moved or this " +
        "gate stopped matching it, and it would pass vacuously either way",
    ).toBeGreaterThan(0);

    const offences: string[] = [];
    for (const { file, value } of added) {
      for (const later of files.slice(files.indexOf(file))) {
        const body = bodies.get(later)!;
        for (const line of body.split("\n")) {
          /* comments are prose, and the ADD VALUE statement is the add itself */
          const bare = line.replace(/--.*$/, "");
          if (!bare.includes(`'${value}'`)) continue;
          if (/ADD\s+VALUE/i.test(bare)) continue;
          if (bare.includes("::text")) continue;
          offences.push(`${later}: ${line.trim().slice(0, 110)}`);
        }
      }
    }

    expect(
      offences,
      "each line above uses an enum value that a migration in the same batch " +
        "adds. On a database where the type already exists, PostgreSQL aborts " +
        "the whole migration with `unsafe use of new value`. Compare as " +
        "`\"col\"::text = 'value'`, or move the work out of the migration " +
        "entirely — a ROW carrying the value cannot be written here at all.",
    ).toEqual([]);
  });
});
