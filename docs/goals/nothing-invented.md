# Goal: nothing invented — the world on real data, end to end

Status: **draft (2026-08-18).** Not started. Branch `goal/nothing-invented`,
from `goal/frontend-you-can-read` @ `f9fff98` (196 commits ahead of
`origin/dev`, which is `ab06133`, the revert of the three-layer world).

Canon: `docs/data-model.md` for the nouns, `GOAL.md` for the world-on-main's-
backend rule. This goal has no model opinions of its own. Where it finds the
design showing something the backend cannot produce, the design gives way.

Follows the schema reconciliation of 2026-08-18, which brought the live Neon
database from a hand-patched two-migration state to the branch's full eleven.
That work ended at the database boundary. This one carries the same question —
*is what I am looking at real?* — across into the screen.

## Why

Four forces. The first is the one that makes the other three worth doing.

1. **Nobody can currently tell real data from invented data by looking.** The
   dev fixture builds four rooms — "Just me" (1 member), "Me and my agent" (2),
   "The four of us" (5), "Our agents" (6) — at `Home.tsx:1609-1613`. The live
   Neon database contains four rooms with **the same four names and the same
   four member counts**, alongside three pieces of debris (`Dbg group`,
   `Cache probe` ×2). A screenshot of the world is therefore not evidence of
   anything. That ambiguity is not cosmetic: it is why a zero-inspirations
   report has been open since 2026-08-17 with the cause still untraced, and why
   `dev` currently carries a revert of 196 commits.

2. **The seeded content is not in the code — it is in the production
   database.** `tools/demo-seed-data.ts:226` holds the exact sentence rendering
   as a top-of-mind belief today: *"You want the first move made for you — in
   tools, and possibly in more than tools."* Ten inspirations carry
   `DEMO_SEED_MARKER` (`[waka-demo-seed]`, defined at `demo-seed-data.ts:55`)
   in their own text. Deleting fixture code would change nothing a signed-in
   person sees, because a signed-in person is reading rows. **Any plan that
   only removes code is aimed at the wrong target.**

3. **The fixture is correctly gated, and that fact has never been written
   down.** Measured 2026-08-18 against the production build served on `:3030`:
   a fresh tab with no cookies, every API call answering 401, lands on the
   sign-in page — not on an invented world. `offlineHome()` returns null unless
   `inventedDataAllowed()`, which is `import.meta.env.DEV` alone, and
   `test/fixture-says-so.test.ts` (166 lines) already asserts every caller.
   The earlier defect — `showsDebug()`, which honours `VITE_SHOW_INTERNAL` and
   so survived a staging build — is genuinely fixed. This goal must not
   "re-fix" it. What is missing is a gate that proves it **on the artifact that
   ships**, rather than on the source that compiles into it.

4. **The schema opened behaviour the design was never told about.** `0007`
   added login throttling: `auth-password.ts:360-367` answers a refused attempt
   with **429** and a `Retry-After` header naming the exact wait.
   `Login.tsx:368-378` branches on `401` and `404` and lets everything else
   fall to a generic `setFormError(err.message)`. A throttled person is shown a
   raw string and no countdown. Aligning the design with the schema means
   this, not only the nouns.

## Shape of the work

Two questions, kept apart on purpose, because conflating them is what makes
this look unsolvable:

- **Does the running design read only from the backend?** — a code and build
  property, provable by a test.
- **Is what the backend holds real?** — a data property, provable only by
  looking at rows, and fixable only by deleting them.

Phases 0–2 settle the first. Phases 3–4 settle the second. Phase 5 spends the
result on the bug that started all of it.

## Budget

No model API calls. One destructive database operation (Phase 3), gated on an
explicit owner decision and a verified backup. Everything else is repo-local.

---

### Phase 0 — Make the instruments trustworthy

Nothing measured below can be believed until these are closed, and one of them
silently breaks every migration written before 2026-08-23.

1. Commit `drizzle/migrations/0002_inspiration_visibility.sql` (working tree,
   guarded, hash `134df2ff…` = ledger row 3) and the untracked
   `drizzle/migrations/meta/0010_snapshot.json`. `HEAD` currently holds the
   unguarded `0002` (`671e08eb…`), which is in no ledger and cannot replay; CI
   will not catch it, because CI migrates an empty database where the bare form
   succeeds. The untracked snapshot is the only thing stopping `db:generate`
   from re-emitting `0007`/`0008`/`0009` as a duplicate `0011`.
2. Retire the fabricated future timestamps. Journal `when` values for
   `0005`–`0010` are hand-typed round numbers; `0010`'s is
   **2026-08-23T15:46:40Z**, and it is now `max(created_at)` in
   `drizzle.__drizzle_migrations`. Drizzle's gate
   (`drizzle-orm/pg-core/dialect.cjs:64`) is
   `Number(lastDbMigration.created_at) < migration.folderMillis` — a high-water
   mark, not a per-hash check — so **every migration authored before that date
   is silently skipped**: exit 0, "migrations applied", never retried. The
   journal and the ledger must move together; editing files alone does nothing.
3. Adopt `scripts/db-integrity.mjs` as the CI gate in place of `db:check`,
   which prints "Everything's fine 🐶🔥" on a repo that had four simultaneous
   ledger defects and never opens a connection.

**Gate:** `node scripts/db-integrity.mjs` exits 0 — all nine assertions. It
reports 7/9 today, and the two failures are exactly item 2.

### Phase 1 — Prove what the design actually reads

Establish the baseline this goal is judged against, in this run, not from
memory.

1. Sign in against the production build on `:3030` and capture the world.
2. For every visible room, memory, signal and top-of-mind entry, record whether
   a database row backs it — by id, not by name. Names are known to collide
   (force 1); ids cannot.
3. Record the count of rendered entities with no backing row.

**Gate:** the number in step 3 is written into `## Log`. If it is **0**, the
design already reads only real data and Phase 2 becomes a regression net rather
than a repair — say so explicitly rather than inventing work.

### Phase 2 — A gate that fails on invented data

`fixture-says-so.test.ts` asserts the *source* calls the right predicate. It
cannot see what a build emits, and the defect it exists because of was found by
a reviewer reading compiled output.

Add an assertion over the built artifact: after `pnpm --filter @waka/web build`,
no fixture identity (`fx-alone`, `fx-pair`, `fx-people`, `fx-agents`,
`FIXTURE1`–`FIXTURE4`, `DEMO_SEED_MARKER`) may appear in `dist/` **reachably**.
Note honestly: those literals are in today's bundle at
`dist/assets/Home-*.js` — minified but present — because Vite does not
tree-shake an unreachable branch's data. So the assertion must be about
reachability, not `grep`. Either
  (a) move every fixture behind a dynamic `import()` the production branch never
      takes, so the strings land in a chunk that is never fetched, and assert the
      chunk is absent from the entry graph; or
  (b) drive the built artifact headlessly with all API routes stubbed to 401 and
      assert the DOM reaches the sign-in door.

(b) is the stronger claim and matches how the original defect was found.

**Gate:** the new check fails when `offlineHome()` is deliberately re-gated to
`showsDebug()` and passes when it is restored. A gate that has never failed has
never been tested.

### Phase 3 — Clear the seeded rows *(destructive — owner decision)*

The rows, measured 2026-08-18: 89 inspirations of which **10** carry
`[waka-demo-seed]`; 16 signals; 13 top-of-mind entries; 7 groups, of which
**3** are debris (`Dbg group`, `Cache probe` ×2) and **4** mirror the fixture
exactly. 13 accounts, 19 profiles, 14 live sessions.

Not every seeded row is safe to delete. `signal_evidence` cites inspirations
M:N, and a signal that loses evidence below three is the exact state the
promotion trigger governs — so deletion order matters, and deleting a cited
inspiration is not a local act.

1. Classify every row as **seeded**, **debris**, or **real**, by marker and by
   id, and write the classification into `## Log` before deleting anything.
2. Establish what a marker cannot reach: the top-of-mind belief at
   `demo-seed-data.ts:226` is seeded but carries **no** marker, so the marker
   undercounts. Enumerate seeded content by matching against the seeder's own
   exported data, not by `LIKE '%[waka-demo-seed]%'`.
3. Take a verified `pg_dump` (pg_dump 17 — the Homebrew default here is 16.15
   and refuses against the 17.10 server).
4. Delete, innermost citation first, inside one transaction.

**Gate:** after deletion, `select count(*) from signals s where s.status='active'
and (select count(*) from signal_evidence e where e.signal_id=s.id) < 3` returns
**0**, and every remaining row is one a named human created. If deletion would
strand an active signal, **stop** — that is the trigger telling you the deletion
order is wrong, not an obstacle to route around.

### Phase 4 — Close the design gaps the schema opened

1. **429.** Teach `Login.tsx` the throttled response: read `Retry-After`
   (`ApiError` at `lib/api/http.ts:48` carries `status`, `message`,
   `fieldErrors` — it will need the header threading through), add a
   `loginThrottled` message to **both** `en-US.json` and `ko-KR.json`, and
   format it with `formatMessage`, which supports `{name}` and
   `{n, plural, one {…} other {…}}`.
2. Audit the rest of `0002`–`0010` for design surface. Already checked:
   `visibility` is fully wired (set at `Home.tsx:7619`, toggled at `8383`,
   flattened to `isPublic` in `lib/data.ts`); a room whose creator was deleted
   renders fine, because the interface never displays a creator. The model
   budget and the re-embed job have no user-facing surface and correctly need
   none.

**Gate:** a throttled sign-in shows the wait in both locales. `pnpm --filter
@waka/web typecheck` clean.

### Phase 5 — The zero-inspirations cause

The reason `dev` is reverted. Its diagnosis in `docs/revert-pr.md` rests on a
false exclusion:

> *"No migration touches inspirations. The four added here are login
> throttling, the model budget, an edit re-embed, and dropping the email
> verification table."*

There are **nine** migrations (`0002`–`0010`), not four, and **`0002` touches
`inspirations` directly** — it added `visibility NOT NULL DEFAULT 'private'`
plus a partial index, and it is the one migration that was applied to the
shared database by hand. The exclusion must be withdrawn before the
investigation is worth resuming.

Known and not yet used: the only `visibility` gate in the API is
`groups-field.ts:74`, on a **room's** ground — the own-wall read does not
filter. So a blanket "everything went private" cannot by itself explain zero on
your own wall.

**Gate (entry):** the stage's `DbConnectionUrl` SST secret is read and compared
to `.env.local`. This is the fork the revert doc itself names and cannot be
settled from this laptop — `pnpm sst secret list --stage dev` fails here with no
AWS credentials. If the stage points at a different database, "empty stage" is
the answer and there is no regression to chase; write that down and stop.

## Out of scope

- Deleting the fixture itself. It exists so the whole layout — every wall, the
  hues, the legend, the pixelated agent orbs — can be looked at without a
  session, and several of those shipped unobserved precisely because it did not
  cover them. The goal is that it cannot **reach production**, which is already
  true and needs proving, not that it stops existing.
- The 11 orphan `waka_test_*` schemas in the production database. Owner elected
  2026-08-18 to leave them.
- The re-land decision for `origin/dev`. Owner reverted deliberately to keep a
  version to compare against; that stands until they say otherwise.

## Log

### Pre-goal — measured 2026-08-18

- Live Neon fully migrated: ledger 11 rows, every hash matching a file
  byte-for-byte, data intact (13 accounts / 19 profiles / 89 inspirations /
  16 signals / 43 evidence / 7 groups). `db:generate` reports no changes.
- `0005`'s transition-only trigger guard verified live by execution, inside a
  rolled-back transaction: promotion with 0 evidence refused; a derivation
  re-write on an under-supported active signal permitted. Before the fix, all
  13 active signals sat at exactly 3 evidence with none holding a fourth.
- `scripts/db-integrity.mjs`: **7/9**. Failing — journal `when` in the future
  (`0006`–`0010`), ledger high-water mark `2026-08-23T15:46:40Z`.
- Production build on `:3030`, fresh tab, no cookies, all API 401 → sign-in
  page. The fixture does not reach production.
- `drizzle.config.ts` fixed to load `.env.local` with `override: true`; before
  it, a placeholder `DB_CONNECTION_URL` in `.env` (a copy of `.env.example`)
  won, and every `db:migrate` died on `HOST.neon.tech` with the error
  swallowed — the likely origin of the hand-applied `0002`/`0003`.
