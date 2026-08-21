#!/usr/bin/env node
/**
 * The drift check `drizzle-kit check` is not.
 *
 * `pnpm db:check` prints "Everything's fine 🐶🔥" on a repo whose ledger disagreed
 * with its own migration files in four separate ways at once. It never opens a
 * connection, so it cannot see the database; it validates only that the snapshot
 * files which happen to exist parse and share no `prevId`. Every failure this
 * repo actually suffered was invisible to it:
 *
 *   - migrations applied by hand, absent from `drizzle.__drizzle_migrations`
 *   - a migration file edited after it ran, so the ledger hash no longer matches
 *   - journal `when` stamps dated in the future, which SILENTLY SKIP the next
 *     migration anyone writes (drizzle's gate is `max(created_at) < folderMillis`
 *     — a high-water mark, not a per-hash check, see drizzle-orm/pg-core/dialect.cjs)
 *   - a placeholder DB_CONNECTION_URL in `.env` shadowing the real one, so every
 *     command that opens a connection died on DNS with the error swallowed
 *
 * This asserts the things that are actually true or false about a deployment.
 * Run it wherever `db:check` is currently trusted.
 *
 *   node scripts/db-integrity.mjs          # full, opens a connection
 *   node scripts/db-integrity.mjs --offline  # file-only assertions
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migDir = join(root, "drizzle", "migrations");
const metaDir = join(migDir, "meta");
const offline = process.argv.includes("--offline");

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const journal = JSON.parse(readFileSync(join(metaDir, "_journal.json"), "utf8"));
const entries = journal.entries ?? [];

/* 1. Every journal entry has the SQL file it names. A journal entry without a
      file is a migration drizzle believes it ran and cannot show you. */
const missingSql = entries.filter((e) => !existsSync(join(migDir, `${e.tag}.sql`)));
check("every journal entry has its .sql", missingSql.length === 0, missingSql.map((e) => e.tag).join(", "));

/* 2. Every SQL file is in the journal. The inverse, and the exact shape of the
      0002/0003 bug: files on disk that `db:migrate` never reads, so a fresh
      database silently lacks what they contain. */
const tags = new Set(entries.map((e) => e.tag));
const orphanSql = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .filter((t) => !tags.has(t));
check("every .sql is in the journal", orphanSql.length === 0, orphanSql.join(", "));

/* 3. The LATEST entry has a snapshot — not every entry. `db:generate` diffs the
      TS schema against the newest snapshot alone, so that one is load-bearing and
      a gap behind it is harmless. Do NOT "fix" older gaps by restoring snapshots:
      two snapshots sharing a `prevId` trip drizzle-kit's collision detector and
      generate begins exiting 0, blocking all future migration authoring. */
const last = entries[entries.length - 1];
const lastSnap = last && join(metaDir, `${String(last.idx).padStart(4, "0")}_snapshot.json`);
check("newest journal entry has a snapshot", !!last && existsSync(lastSnap), last ? `${last.tag} -> ${lastSnap?.split("/").pop()}` : "no entries");

/* 4. No journal stamp in the future. This is the silent-skip trap: drizzle applies
      a migration only when its folderMillis exceeds max(created_at) in the ledger,
      so one future stamp suppresses every migration authored before that date —
      no error, exit 0, "migrations applied", and never retried. */
const now = Date.now();
const future = entries.filter((e) => e.when > now);
check(
  "no journal `when` is in the future",
  future.length === 0,
  future.map((e) => `${e.tag} @ ${new Date(e.when).toISOString()}`).join(", "),
);

/* 5. Stamps strictly increase, or ordering is not what the ledger enforces. */
const unordered = entries.filter((e, i) => i > 0 && e.when <= entries[i - 1].when);
check("journal `when` strictly increases", unordered.length === 0, unordered.map((e) => e.tag).join(", "));

if (!offline) {
  const { config } = await import("dotenv");
  config({ path: join(root, ".env.local"), override: true });
  config({ path: join(root, ".env"), override: false });
  const url = process.env.DB_CONNECTION_URL;

  /* 6. The connection string is real. A placeholder here is why db:migrate died
        silently for weeks; .env is a copy of .env.example and still carries one. */
  const host = url ? new URL(url).hostname : "";
  check("DB_CONNECTION_URL is not a placeholder", !!url && !/^HOST\.|USER:PASSWORD/.test(url) && host.includes("."), `host=${host || "unset"}`);

  if (url && host.includes(".") && !/^HOST\./.test(host)) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`select hash, created_at from drizzle.__drizzle_migrations order by id`;

      /* 7. The ledger records exactly the migrations the journal claims. */
      check("ledger count == journal count", rows.length === entries.length, `ledger=${rows.length} journal=${entries.length}`);

      /* 8. Every ledger hash is the sha256 of the file still on disk. Catches a
            migration edited after it ran — which is invisible to every other gate
            and means a fresh clone replays something production never saw. */
      const bad = [];
      for (const e of entries) {
        const f = join(migDir, `${e.tag}.sql`);
        if (!existsSync(f)) continue;
        const h = createHash("sha256").update(readFileSync(f)).digest("hex");
        if (!rows.some((r) => r.hash === h)) bad.push(e.tag);
      }
      check("every migration file's hash is in the ledger", bad.length === 0, bad.join(", "));

      /* 9. The ledger's high-water mark is in the past, or the NEXT migration is
            skipped no matter what the journal says. */
      const maxAt = rows.reduce((m, r) => Math.max(m, Number(r.created_at)), 0);
      check("ledger high-water mark is in the past", maxAt <= now, `max=${new Date(maxAt).toISOString()} now=${new Date(now).toISOString()}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.name}${r.detail ? `\n         ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
