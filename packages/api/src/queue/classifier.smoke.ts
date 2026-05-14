/**
 * Standalone smoke test for the legacy classifier SQS-shaped compatibility
 * handler (Sub-AC 10.3.4). The current product path is DB-backed
 * `background_jobs`; this file only preserves the old partial-batch wrapper.
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/queue/classifier.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Same one-off-script style as the
 * other `*.smoke.ts` files in this package. The Gemini HTTP call is stubbed
 * via a temporary `globalThis.fetch` override so this script can run offline,
 * doesn't burn rate limits, and produces deterministic outputs across CI.
 *
 * What we cover
 * -------------
 *   1. Malformed payload (non-JSON body) → no `batchItemFailures`, NOT retried;
 *      poisoned messages must drop, not loop.
 *   2. Missing-field payload (`{}`) → same drop semantics.
 *   3. Inspiration row not found → drop; nothing to classify, retry would
 *      repeat the same SELECT forever.
 *   4. Already-classified row (cluster IS NOT NULL) → drop and skip the Gemini
 *      call entirely. Asserts that `fetch` is NOT invoked in this branch.
 *   5. Happy path: Gemini returns a canonical label → row's cluster +
 *      classified_at + updated_at are persisted; created_at unchanged.
 *   6. Gemini permanent skip (safety block / out-of-set / null cluster) →
 *      row stays cluster=NULL, message ack'd (NOT retried). Same outcome
 *      whether the response is a documented `promptFeedback.blockReason` or
 *      an out-of-set label.
 *   7. Gemini transient HTTP 5xx → message id appears in `batchItemFailures`
 *      so legacy callers retry. Row stays NULL.
 *   8. Gemini network throw (fetch rejects) → same retry semantics as 5xx.
 *   9. Idempotency under at-least-once delivery: replaying the same job
 *      twice in one batch updates the row exactly once and the second
 *      worker's UPDATE no-ops (the `WHERE cluster IS NULL` predicate).
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { type Cluster, inspirations, users } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { handler } from "./classifier.js";

// ---------------------------------------------------------------------------
// Fetch stub
// ---------------------------------------------------------------------------

/**
 * Holds the fetch behaviour the next handler invocation should see. The
 * global `fetch` override below reads this and produces a Response shaped
 * like Gemini's `:generateContent` output.
 *
 * Using a mutable shared variable rather than re-installing `fetch` between
 * cases keeps the test linear and easy to read — each numbered scenario sets
 * `nextFetch.mode` and asserts on the side-effects.
 */
type FetchMode =
  | { kind: "label"; label: Cluster } // 200 OK, valid cluster
  | { kind: "block"; blockReason: string } // 200 OK, promptFeedback block
  | { kind: "outOfSet"; text: string } // 200 OK, label not in enum
  | { kind: "http5xx"; status: number; body: string }
  | { kind: "throw"; message: string }
  | { kind: "unexpected" }; // calling fetch should fail the test

const nextFetch: { mode: FetchMode; calls: number } = {
  mode: { kind: "unexpected" },
  calls: 0,
};

const realFetch = globalThis.fetch;

globalThis.fetch = (async (
  input: Parameters<typeof realFetch>[0],
  init?: Parameters<typeof realFetch>[1],
) => {
  // Only stub Gemini calls — let everything else (e.g. Neon over HTTPS via
  // postgres-js doesn't actually use fetch, but be defensive) hit the real
  // implementation. The `generativelanguage` host is what `gemini.ts`
  // hits; matching on it keeps the stub narrowly scoped.
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

  if (!url.includes("generativelanguage.googleapis.com")) {
    return realFetch(input, init);
  }

  nextFetch.calls += 1;
  const mode = nextFetch.mode;

  switch (mode.kind) {
    case "label": {
      const body = {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(mode.label) }] },
            finishReason: "STOP",
          },
        ],
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    case "block": {
      const body = {
        promptFeedback: { blockReason: mode.blockReason },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    case "outOfSet": {
      const body = {
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(mode.text) }] },
            finishReason: "STOP",
          },
        ],
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    case "http5xx":
      return new Response(mode.body, { status: mode.status });
    case "throw":
      throw new Error(mode.message);
    case "unexpected":
      throw new Error(
        "fetch was called when nextFetch.mode === 'unexpected' — " +
          "the handler invoked Gemini in a branch that should have short-circuited.",
      );
  }
}) as typeof realFetch;

// Force a fake API key so `getGeminiApiKey()` doesn't throw before our stub
// can intercept the request. We set this even if the real one is present so
// no live calls leak through if a future code path bypasses the stub.
process.env.GEMINI_API_KEY = "smoke-test-fake-key-ignored-by-stub";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assert: ${msg}`);
}

function makeEvent(records: { messageId: string; body: string }[]) {
  return { Records: records };
}

async function insertUser(label: string) {
  const db = getDb();
  const [row] = await db
    .insert(users)
    .values({
      email: `classifier-smoke-${label}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@example.test`,
      name: `Classifier Smoke ${label}`,
      passwordHash: "x", // not used; column is nullable but easier to set
    })
    .returning();
  if (!row) throw new Error("Failed to insert smoke user");
  return row;
}

async function insertInspiration(userId: string, text: string) {
  const db = getDb();
  const [row] = await db
    .insert(inspirations)
    .values({ userId, text })
    .returning();
  if (!row) throw new Error("Failed to insert smoke inspiration");
  return row;
}

async function loadRow(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(inspirations)
    .where(eq(inspirations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function deleteUser(id: string) {
  const db = getDb();
  // ON DELETE CASCADE on inspirations.user_id cleans up child rows.
  await db.delete(users).where(eq(users.id, id));
}

function resetFetchCounter(mode: FetchMode) {
  nextFetch.mode = mode;
  nextFetch.calls = 0;
}

/**
 * Reads `nextFetch.calls` through a function so TypeScript's control-flow
 * analysis doesn't narrow it to the literal `0` it last saw assigned in the
 * same lexical scope. The global fetch override (executed inside `handler`)
 * mutates this counter asynchronously, but TS can't see across the closure
 * boundary — without this indirection, every `=== 1` comparison after a
 * `resetFetchCounter` call looks unsatisfiable to the compiler.
 */
function getFetchCalls(): number {
  return nextFetch.calls;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function main() {
  const user = await insertUser("u1");
  const createdInspirationIds: string[] = [];

  try {
    // ---------------------------------------------------------------------
    // 1. Malformed JSON body → drop (no batchItemFailures)
    // ---------------------------------------------------------------------
    resetFetchCounter({ kind: "unexpected" });
    {
      const res = await handler(
        makeEvent([{ messageId: "m1", body: "not-json{" }]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "malformed JSON must NOT be retried (no batchItemFailures)",
      );
      assert(
        getFetchCalls() === 0,
        "malformed JSON must short-circuit before fetch",
      );
    }
    console.log("[1/9] malformed JSON dropped, not retried ✅");

    // ---------------------------------------------------------------------
    // 2. Missing-field body → drop
    // ---------------------------------------------------------------------
    resetFetchCounter({ kind: "unexpected" });
    {
      const res = await handler(
        makeEvent([{ messageId: "m2", body: JSON.stringify({}) }]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "missing inspirationId must NOT be retried",
      );
      assert(
        getFetchCalls() === 0,
        "missing inspirationId must short-circuit before fetch",
      );
    }
    console.log("[2/9] missing inspirationId dropped, not retried ✅");

    // ---------------------------------------------------------------------
    // 3. Row not found → drop (no DB write, no fetch)
    // ---------------------------------------------------------------------
    resetFetchCounter({ kind: "unexpected" });
    {
      const ghostId = "00000000-0000-0000-0000-000000000000";
      const res = await handler(
        makeEvent([
          {
            messageId: "m3",
            body: JSON.stringify({ inspirationId: ghostId }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "row-not-found must NOT be retried",
      );
      assert(
        getFetchCalls() === 0,
        "row-not-found must short-circuit before fetch",
      );
    }
    console.log("[3/9] row-not-found dropped, not retried ✅");

    // ---------------------------------------------------------------------
    // 4. Already-classified row → drop, skip Gemini entirely
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(user.id, "already done");
      createdInspirationIds.push(insp.id);
      // Pre-populate cluster directly so the handler should short-circuit.
      const db = getDb();
      await db
        .update(inspirations)
        .set({ cluster: "loop", classifiedAt: new Date() })
        .where(eq(inspirations.id, insp.id));

      resetFetchCounter({ kind: "unexpected" });
      const res = await handler(
        makeEvent([
          {
            messageId: "m4",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "already-classified row must NOT be retried",
      );
      assert(
        getFetchCalls() === 0,
        "already-classified row must NOT call Gemini",
      );
      const after = await loadRow(insp.id);
      assert(after?.cluster === "loop", "cluster must be unchanged");
    }
    console.log("[4/9] already-classified row skipped without Gemini call ✅");

    // ---------------------------------------------------------------------
    // 5. Happy path: Gemini returns valid label → row updated
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(
        user.id,
        "the more I optimise the slower I get",
      );
      createdInspirationIds.push(insp.id);
      const beforeCreated = insp.createdAt;

      resetFetchCounter({ kind: "label", label: "loop" });
      const res = await handler(
        makeEvent([
          {
            messageId: "m5",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "happy path must produce no failures",
      );
      assert(getFetchCalls() === 1, "happy path must call fetch exactly once");

      const after = await loadRow(insp.id);
      assert(after !== null, "row must still exist after classification");
      assert(
        after!.cluster === "loop",
        `cluster must be 'loop', got ${JSON.stringify(after!.cluster)}`,
      );
      assert(
        after!.classifiedAt !== null,
        "classifiedAt must be set after classification",
      );
      assert(
        after!.updatedAt.getTime() >= beforeCreated.getTime(),
        "updatedAt must advance to >= createdAt after classification",
      );
      assert(
        after!.createdAt.getTime() === beforeCreated.getTime(),
        "createdAt must NOT change during classification",
      );
    }
    console.log(
      "[5/9] happy path persists cluster + classified_at, preserves createdAt ✅",
    );

    // ---------------------------------------------------------------------
    // 6a. Gemini permanent skip — safety block → row stays NULL, no retry
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(user.id, "borderline content");
      createdInspirationIds.push(insp.id);

      resetFetchCounter({ kind: "block", blockReason: "SAFETY" });
      const res = await handler(
        makeEvent([
          {
            messageId: "m6a",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "permanent skip (safety block) must NOT be retried",
      );
      const after = await loadRow(insp.id);
      assert(after?.cluster === null, "cluster must remain NULL on block");
      assert(
        after?.classifiedAt === null,
        "classifiedAt must remain NULL on block",
      );
    }
    console.log("[6a/9] gemini safety block → row stays NULL, ack'd ✅");

    // ---------------------------------------------------------------------
    // 6b. Gemini permanent skip — out-of-set label → row stays NULL
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(user.id, "weird input");
      createdInspirationIds.push(insp.id);

      resetFetchCounter({ kind: "outOfSet", text: "banana" });
      const res = await handler(
        makeEvent([
          {
            messageId: "m6b",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "permanent skip (out-of-set label) must NOT be retried",
      );
      const after = await loadRow(insp.id);
      assert(
        after?.cluster === null,
        "cluster must remain NULL when Gemini returns out-of-set label",
      );
    }
    console.log("[6b/9] gemini out-of-set label → row stays NULL, ack'd ✅");

    // ---------------------------------------------------------------------
    // 7. Transient HTTP 5xx → batchItemFailures, row stays NULL
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(user.id, "flaky day at gemini");
      createdInspirationIds.push(insp.id);

      resetFetchCounter({
        kind: "http5xx",
        status: 503,
        body: "service unavailable",
      });
      const res = await handler(
        makeEvent([
          {
            messageId: "m7",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 1 &&
          res.batchItemFailures[0]?.itemIdentifier === "m7",
        `5xx must produce batchItemFailures[m7]; got ${JSON.stringify(
          res.batchItemFailures,
        )}`,
      );
      const after = await loadRow(insp.id);
      assert(
        after?.cluster === null,
        "cluster must stay NULL on transient failure (so retry can fill it)",
      );
    }
    console.log("[7/9] gemini 5xx → batchItemFailures, row stays NULL ✅");

    // ---------------------------------------------------------------------
    // 8. Network-level fetch throw → batchItemFailures
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(user.id, "neon blink at gemini");
      createdInspirationIds.push(insp.id);

      resetFetchCounter({ kind: "throw", message: "ECONNRESET" });
      const res = await handler(
        makeEvent([
          {
            messageId: "m8",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 1 &&
          res.batchItemFailures[0]?.itemIdentifier === "m8",
        `network throw must produce batchItemFailures[m8]; got ${JSON.stringify(
          res.batchItemFailures,
        )}`,
      );
      const after = await loadRow(insp.id);
      assert(
        after?.cluster === null,
        "cluster must stay NULL on network throw",
      );
    }
    console.log("[8/9] gemini network throw → batchItemFailures, NULL ✅");

    // ---------------------------------------------------------------------
    // 9. Idempotency under at-least-once delivery: same job twice in batch.
    //    First record updates the row; second sees cluster IS NOT NULL and
    //    short-circuits. Both must succeed (no batchItemFailures), and the
    //    final cluster must equal the FIRST result, not the second.
    // ---------------------------------------------------------------------
    {
      const insp = await insertInspiration(user.id, "loop redux");
      createdInspirationIds.push(insp.id);

      resetFetchCounter({ kind: "label", label: "tension" });
      const res = await handler(
        makeEvent([
          {
            messageId: "m9-a",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
          {
            messageId: "m9-b",
            body: JSON.stringify({ inspirationId: insp.id }),
          },
        ]),
      );
      assert(
        res.batchItemFailures.length === 0,
        "duplicate delivery must produce no failures",
      );
      // First call hits Gemini; second call short-circuits at the
      // already-classified guard (Gemini NOT called again).
      assert(
        getFetchCalls() === 1,
        `duplicate delivery must invoke Gemini exactly once, got ${getFetchCalls()}`,
      );
      const after = await loadRow(insp.id);
      assert(
        after?.cluster === "tension",
        `final cluster must be 'tension', got ${JSON.stringify(after?.cluster)}`,
      );
    }
    console.log("[9/9] duplicate delivery is idempotent, single Gemini call ✅");
  } finally {
    // Restore original fetch so any subsequent process activity is unaffected.
    globalThis.fetch = realFetch;
    // ON DELETE CASCADE drops every inspiration we created.
    await deleteUser(user.id);
  }
}

main()
  .then(() => {
    console.log("ALL SMOKE TESTS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
