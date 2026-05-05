/**
 * Inserted-row cleanup tracker for route-integration tests.
 *
 * Why this exists
 * ---------------
 * Route-integration tests in this package drive the production Hono app
 * (`app.request(...)`) which writes through the `getDb()` singleton — bound
 * to the shared `public` schema on the live Neon database pinned by
 * `DB_CONNECTION_URL`. That's the same schema the developer's `sst dev`
 * session uses. A test that inserts a user / inspiration / attachment /
 * reflection but doesn't clean up afterwards leaves the row visible to the
 * next person who runs `sst dev`, contaminates parallel test files, and
 * eventually produces flaky 409s on duplicate-email assertions.
 *
 * `auth.test.ts` already implements the pattern inline:
 *
 *     const insertedUserIds = new Set<string>();
 *     afterEach(async () => {
 *       if (insertedUserIds.size === 0) return;
 *       const ids = [...insertedUserIds];
 *       insertedUserIds.clear();
 *       await getDb().delete(users).where(inArray(users.id, ids));
 *     });
 *
 * Inspiration CRUD tests need the same hygiene, with a small extension —
 * they may also want to track inspiration / attachment / reflection rows
 * inserted directly via Drizzle (when the test sets up state without going
 * through the API). Rather than copy-paste the tracker per file, this
 * module exports a reusable factory.
 *
 * Cascade behaviour we lean on
 * ----------------------------
 * Deleting a `users` row reaps EVERYTHING owned by that user via the
 * existing FK CASCADEs:
 *
 *   users.id ←CASCADE— sessions.user_id        (lib/sessions)
 *           ←CASCADE— inspirations.user_id    (drizzle migration 0001)
 *           ←CASCADE— reflections.user_id     (drizzle migration 0003)
 *
 * And inside an inspiration:
 *
 *   inspirations.id ←CASCADE— attachments.inspiration_id  (migration 0002)
 *                  ←CASCADE— reflections.inspiration_id   (migration 0003)
 *
 * So the cheapest correct cleanup is "track the user ids you created and
 * delete them at the end". The tracker therefore optimises for that path
 * while still letting a test register orphan inspiration / attachment /
 * reflection ids if it inserts them out-of-band.
 *
 * Lifecycle contract
 * ------------------
 * Always pair the tracker with `afterEach` AND `afterAll`:
 *
 *     const cleanup = createCleanupTracker();
 *
 *     afterEach(async () => { await cleanup.flush(); });
 *     afterAll(async () => { await cleanup.flush(); });
 *
 * The double-flush is intentional. `afterEach` keeps the schema clean
 * between specs (so a duplicate-email test doesn't poison a follow-up
 * insert with the same address). `afterAll` is belt-and-braces — if a spec
 * throws before its `afterEach` runs, the suite-level hook still reaps the
 * orphan. Both hooks are idempotent; calling `flush()` on an empty tracker
 * is a no-op.
 *
 * Determinism
 * -----------
 * The tracker uses `Set` so duplicate `track(id)` calls are safe (a single
 * DELETE … WHERE id IN (...) covers all of them). Order of deletion is
 * children → parents (reflections → attachments → inspirations → users) so
 * even if a future schema change weakens a CASCADE, the cleanup still
 * succeeds.
 */

import { inArray } from "drizzle-orm";

import {
  attachments,
  inspirations,
  reflections,
  users,
} from "../../src/db/index.js";
import { getDb } from "../../src/lib/db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Public surface of the tracker. All `track*` methods are synchronous —
 * they only push an id into a local set; the actual DB round-trip happens
 * in `flush()`.
 *
 * Each `track*` method returns the id it was given so call sites can chain:
 *
 *     const userId = cleanup.trackUser(body.user.id);
 *     // userId is the same string, ready to use in the next assertion.
 */
export interface CleanupTracker {
  /** Schedule a user id for deletion. CASCADE reaps everything below it. */
  trackUser(id: string): string;
  /** Schedule a user id (or many) for deletion in one call. */
  trackUsers(ids: string[]): string[];
  /**
   * Schedule an inspiration id for deletion. Use this only when the test
   * inserts an orphan inspiration that does NOT belong to a tracked user
   * (rare — most tests should `trackUser` and let CASCADE do the work).
   */
  trackInspiration(id: string): string;
  /**
   * Schedule an attachment id for deletion. Same rarity caveat as
   * `trackInspiration`.
   */
  trackAttachment(id: string): string;
  /**
   * Schedule a reflection id for deletion. Same rarity caveat as
   * `trackInspiration`.
   */
  trackReflection(id: string): string;

  /**
   * Number of distinct ids scheduled for deletion across all tables.
   * Useful for sanity-asserting "this test inserted exactly N rows" before
   * the afterEach runs.
   */
  readonly size: number;

  /**
   * DELETE every tracked row. Children are deleted before parents so a
   * future weakened CASCADE cannot leave orphans behind. Idempotent:
   * calling on an empty tracker is a no-op. After flush, the tracker is
   * empty and reusable for the next test.
   *
   * Errors during DELETE are logged via `console.warn` and swallowed —
   * a cleanup failure must never mask the original test failure.
   */
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a fresh tracker. Typical usage:
 *
 *     const cleanup = createCleanupTracker();
 *     afterEach(() => cleanup.flush());
 *     afterAll(() => cleanup.flush());
 *
 *     it("creates an inspiration", async () => {
 *       const alice = await createUserFixture(getDb());
 *       cleanup.trackUser(alice.user.id);
 *       // ... drive `app.request("/inspirations", ...)` etc.
 *     });
 */
export function createCleanupTracker(): CleanupTracker {
  const userIds = new Set<string>();
  const inspirationIds = new Set<string>();
  const attachmentIds = new Set<string>();
  const reflectionIds = new Set<string>();

  const tracker: CleanupTracker = {
    trackUser(id) {
      userIds.add(id);
      return id;
    },
    trackUsers(ids) {
      for (const id of ids) userIds.add(id);
      return ids;
    },
    trackInspiration(id) {
      inspirationIds.add(id);
      return id;
    },
    trackAttachment(id) {
      attachmentIds.add(id);
      return id;
    },
    trackReflection(id) {
      reflectionIds.add(id);
      return id;
    },
    get size() {
      return (
        userIds.size + inspirationIds.size + attachmentIds.size + reflectionIds.size
      );
    },
    async flush() {
      // Snapshot + clear up front so a `trackUser(...)` call inside a
      // concurrent test (rare, but possible if `flush()` is awaited mid-
      // test for some diagnostic reason) doesn't get accidentally reaped
      // alongside the rows we're about to delete.
      const userIdsSnap = [...userIds];
      const inspirationIdsSnap = [...inspirationIds];
      const attachmentIdsSnap = [...attachmentIds];
      const reflectionIdsSnap = [...reflectionIds];
      userIds.clear();
      inspirationIds.clear();
      attachmentIds.clear();
      reflectionIds.clear();

      const total =
        userIdsSnap.length +
        inspirationIdsSnap.length +
        attachmentIdsSnap.length +
        reflectionIdsSnap.length;
      if (total === 0) return;

      const db = getDb();

      // Children → parents. Each delete is wrapped individually so a
      // single failure (e.g. a constraint we didn't know about) doesn't
      // strand later groups uncleaned.
      if (reflectionIdsSnap.length > 0) {
        try {
          await db
            .delete(reflections)
            .where(inArray(reflections.id, reflectionIdsSnap));
        } catch (err) {
          warnCleanupFailure("reflections", reflectionIdsSnap, err);
        }
      }
      if (attachmentIdsSnap.length > 0) {
        try {
          await db
            .delete(attachments)
            .where(inArray(attachments.id, attachmentIdsSnap));
        } catch (err) {
          warnCleanupFailure("attachments", attachmentIdsSnap, err);
        }
      }
      if (inspirationIdsSnap.length > 0) {
        try {
          await db
            .delete(inspirations)
            .where(inArray(inspirations.id, inspirationIdsSnap));
        } catch (err) {
          warnCleanupFailure("inspirations", inspirationIdsSnap, err);
        }
      }
      // Users last — CASCADE will reap any rows we didn't explicitly track
      // (e.g. attachments inserted by the API path the test exercised).
      if (userIdsSnap.length > 0) {
        try {
          await db.delete(users).where(inArray(users.id, userIdsSnap));
        } catch (err) {
          warnCleanupFailure("users", userIdsSnap, err);
        }
      }
    },
  };

  return tracker;
}

/**
 * Log a cleanup failure with enough context for a developer to manually
 * reap the orphan rows from Neon Studio. We deliberately do NOT throw —
 * a cleanup failure must never mask the test's primary failure.
 */
function warnCleanupFailure(
  table: string,
  ids: string[],
  err: unknown,
): void {
  const sample = ids.slice(0, 5).join(", ");
  const moreSuffix = ids.length > 5 ? `, … (+${ids.length - 5} more)` : "";
  console.warn(
    `[test/cleanup] Failed to delete ${ids.length} row(s) from "${table}" — ` +
      `manual cleanup may be required.\n` +
      `  ids: ${sample}${moreSuffix}\n` +
      `  cause: ${err instanceof Error ? err.message : String(err)}`,
  );
}
