/**
 * Classifier compatibility-handler test suite — Sub-AC 13.5.
 *
 * Surface under test
 * ------------------
 * `src/queue/classifier.ts` owns the classifier core. Its handler export is a
 * legacy SQS-shaped compatibility wrapper; the current product path is
 * DB-backed `background_jobs` drained by `src/lib/queue.ts`. Per AC 10/11 the
 * classifier must:
 *
 *   1. Parse `{ inspirationId }` from each legacy record body.
 *   2. SELECT the inspiration row by id; DB-backed callers additionally pass
 *      `background_jobs.user_id` for tenant scoping.
 *   3. Call Gemini via `classifyInspirationText` (gemini.ts).
 *   4. UPDATE the row's `cluster` + `classified_at` + `updated_at` on a valid
 *      label, guarded by `WHERE cluster IS NULL` for at-least-once idempotency.
 *
 * The compatibility handler returns a partial-batch-shaped response whose
 * `batchItemFailures[]` lists transient messageIds. This test suite covers the three
 * coverage buckets the Seed mandates for queue/Gemini work:
 *
 *   • Message processing      — happy parse, malformed JSON, missing field,
 *                               row-not-found, already-classified short-circuit
 *   • Cluster assignment persistence — every valid label survives a round-trip
 *                               through Gemini → handler → Postgres; UPDATE
 *                               is guarded by `cluster IS NULL`; updatedAt
 *                               ticks while createdAt stays put
 *   • Error handling          — permanent skip (safety block / out-of-set /
 *                               malformed envelope / empty text) leaves
 *                               cluster NULL and ACKs; transient failure
 *                               (5xx / network throw / non-JSON) returns
 *                               batchItemFailures so legacy callers retry
 *
 * Why we drive the live handler against the real DB
 * -------------------------------------------------
 * Stubbing Drizzle here would replace the SELECT/UPDATE pair with hand-written
 * assumptions, hiding the very predicates that close
 * the at-least-once race (`WHERE id = :id AND cluster IS NULL`). We exercise
 * the production `getDb()` singleton against the same Neon database the
 * smoke test uses, with cleanup-tracked users so cascade reaps everything.
 *
 * Why we mock Gemini at the fetch boundary
 * ----------------------------------------
 * The Seed bans live Gemini calls during `pnpm test` (cost / determinism /
 * offline-CI). The shared `test/mocks/gemini.ts` harness swaps
 * `globalThis.fetch` for Gemini's host only — Neon's HTTPS and any other
 * network code passes through. Mocking the *transport* (rather than
 * `classifyInspirationText` itself) keeps both the prompt builder and the
 * response parser under test.
 *
 * Cleanup
 * -------
 * Every user inserted by `createUserFixture` is tracked via
 * `createCleanupTracker()` and reaped in `afterEach`. FK CASCADE on
 * `inspirations.user_id` removes every child row in one round-trip. The
 * Gemini mock is restored in `afterAll` so the global `fetch` is unaffected
 * by suite teardown.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { eq } from "drizzle-orm";

import {
  backgroundJobs,
  type Cluster,
  clusterEnumValues,
  inspirations,
  wowMoments,
} from "../src/db/index.js";
import { getDb } from "../src/lib/db.js";
import { handler, runClassificationJob } from "../src/queue/classifier.js";

import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { createCleanupTracker } from "./helpers/index.js";
import {
  type GeminiMockHandle,
  geminiBlock,
  geminiHttpError,
  geminiLabel,
  geminiMalformed,
  geminiNetworkError,
  geminiNonJson,
  geminiOutOfSet,
  installGeminiMock,
} from "./mocks/gemini.js";

// ---------------------------------------------------------------------------
// Shared lifecycle: install Gemini mock once, reset between tests, restore
// after the suite. The `cleanup` tracker reaps inserted users so cascade
// removes inspirations.
// ---------------------------------------------------------------------------

const cleanup = createCleanupTracker();

let gemini: GeminiMockHandle;

beforeAll(() => {
  // Tripwire — the handler reads GEMINI_API_KEY before fetching, and would
  // throw a configuration error before our mock could intercept the call.
  // Force a synthetic key so the production resolver succeeds even if the
  // developer's `.env` doesn't have a real one.
  if (!process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = "vitest-fake-key-stub-only";
  }
  gemini = installGeminiMock();
});

beforeEach(() => {
  // Each test starts from an empty queue + call log + the fail-fast default.
  // A test that wants to assert "Gemini was NEVER called" simply doesn't
  // queue a response and relies on the throw-on-empty default.
  gemini.reset();
});

afterEach(async () => {
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
  gemini?.restore();
});

// ---------------------------------------------------------------------------
// Local helpers — the legacy SQS-shaped event is intentionally minimal (matches
// the `SQSEventLike` subset the handler depends on) so we don't need to pull in
// `@types/aws-lambda` just to build a test fixture.
// ---------------------------------------------------------------------------

interface TestRecord {
  messageId: string;
  body: string;
}

function makeEvent(records: TestRecord[]): { Records: TestRecord[] } {
  return { Records: records };
}

function jobBody(inspirationId: string): string {
  return JSON.stringify({ inspirationId });
}

function classifierGeminiCalls() {
  return gemini.calls.filter((call) => call.url.includes(":generateContent"));
}

/**
 * Read the row directly from Postgres so a test can assert the persisted
 * state — never relying on the handler's return value to prove the UPDATE
 * actually landed.
 */
async function loadRow(id: string) {
  const rows = await getDb()
    .select()
    .from(inspirations)
    .where(eq(inspirations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Bucket 1 — Message processing
// ---------------------------------------------------------------------------

describe("classifier handler — message processing", () => {
  it("drops malformed JSON without retry and never calls Gemini", async () => {
    // Poisoned messages must NOT be retried — the body will never parse, so
    // re-delivery just burns budget. Contract: ack (drop from queue), log,
    // never invoke Gemini.
    const res = await handler(
      makeEvent([{ messageId: "m-bad-json", body: "not-json{" }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    expect(classifierGeminiCalls()).toHaveLength(0);
  });

  it("drops a body missing inspirationId without retry", async () => {
    const res = await handler(
      makeEvent([{ messageId: "m-empty-obj", body: JSON.stringify({}) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    expect(classifierGeminiCalls()).toHaveLength(0);
  });

  it("drops a body whose inspirationId is the wrong type", async () => {
    // `inspirationId: 42` (number) and `inspirationId: ""` (empty string)
    // both fail the parser's narrow type check. Both must drop, never retry.
    const numeric = await handler(
      makeEvent([
        { messageId: "m-num", body: JSON.stringify({ inspirationId: 42 }) },
      ]),
    );
    expect(numeric.batchItemFailures).toHaveLength(0);

    const blank = await handler(
      makeEvent([
        { messageId: "m-blank", body: JSON.stringify({ inspirationId: "" }) },
      ]),
    );
    expect(blank.batchItemFailures).toHaveLength(0);

    const whitespace = await handler(
      makeEvent([
        {
          messageId: "m-ws",
          body: JSON.stringify({ inspirationId: "   " }),
        },
      ]),
    );
    expect(whitespace.batchItemFailures).toHaveLength(0);

    expect(classifierGeminiCalls()).toHaveLength(0);
  });

  it("drops a row-not-found message without retry", async () => {
    // The id is a syntactically valid uuid that almost certainly doesn't
    // exist. The row was deleted between enqueue and consume (e.g. user
    // removed it). Retry would only repeat the same SELECT.
    const ghostId = "00000000-0000-0000-0000-000000000000";

    const res = await handler(
      makeEvent([{ messageId: "m-ghost", body: jobBody(ghostId) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    expect(classifierGeminiCalls()).toHaveLength(0);
  });

  it("short-circuits an already-classified row without calling Gemini", async () => {
    // Pre-populate `cluster` so the handler's "already classified" guard
    // fires. The Gemini mock has no scripted response — if the handler
    // *did* call Gemini, the mock's fail-fast default would throw, surfacing
    // the regression as a clear test failure rather than a silent extra call.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "already done",
      cluster: "loop",
      classifiedAt: new Date(),
    });

    const res = await handler(
      makeEvent([{ messageId: "m-pre", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    expect(classifierGeminiCalls()).toHaveLength(0);

    const after = await loadRow(insp.id);
    // Cluster is unchanged — the worker did NOT clobber the prior label.
    expect(after?.cluster).toBe("loop");
  });

  it("processes a single happy-path record — exactly one Gemini call", async () => {
    // Bare-minimum positive case: one record, scripted label, assert the
    // handler reached Gemini exactly once and wrote no batchItemFailures.
    // Detailed persistence assertions live in the next bucket.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "the more I optimise the slower I get",
    });

    gemini.queueResponse(geminiLabel("loop"));

    const res = await handler(
      makeEvent([{ messageId: "m-ok", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    const call = classifierGeminiCalls()[0];
    expect(call).toBeDefined();
    // The request body MUST contain the inspiration text — proves the
    // handler passed the actual row text to Gemini (not, say, an empty
    // string from a mis-shaped read).
    expect(call.body).toContain("the more I optimise the slower I get");
    expect(call.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
    expect(call.url).not.toContain("?key=");
    expect(call.headers["x-goog-api-key"]).toBeTruthy();
    expect(call.headers["content-type"]).toBe("application/json");
  });

  it("processes mixed records in a single batch independently", async () => {
    // Legacy batches can contain a mix of valid + malformed + ghost records.
    // Each record's outcome must be independent — one bad record never
    // poisons the whole batch.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const valid = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "valid record text",
    });

    gemini.queueResponse(geminiLabel("bridge"));

    const res = await handler(
      makeEvent([
        { messageId: "m-bad", body: "not-json{" }, // drop, no retry
        { messageId: "m-empty", body: JSON.stringify({}) }, // drop, no retry
        { messageId: "m-valid", body: jobBody(valid.id) }, // happy path
      ]),
    );

    // None of these scenarios should appear in batchItemFailures: malformed
    // is permanent-skip; valid succeeded.
    expect(res.batchItemFailures).toHaveLength(0);
    // Only the valid record reached Gemini.
    expect(classifierGeminiCalls()).toHaveLength(1);

    const after = await loadRow(valid.id);
    expect(after?.cluster).toBe("bridge");
  });
});

// ---------------------------------------------------------------------------
// Bucket 1b — Async automatic WOW handoff
// ---------------------------------------------------------------------------

describe("classifier job — automatic WOW handoff", () => {
  it("attempts automatic WOW generation after a created inspiration is classified", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "classification can unlock a wow attempt",
    });
    const generateAutoWowMoment = vi.fn(async () => ({
      status: "not_wow" as const,
      generated: false,
      embeddingStatus: "unchanged" as const,
      judgment: {
        isWowMoment: false as const,
        reason: "generic_similarity" as const,
        debugSummary: "Only a generic topical overlap was found.",
      },
    }));

    gemini.queueResponse(geminiLabel("bridge"));

    const [job] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: insp.id },
      })
      .returning({ id: backgroundJobs.id });

    await runClassificationJob(insp.id, {
      generateAutoWowMoment,
      backgroundJobId: job!.id,
    });

    expect(generateAutoWowMoment).toHaveBeenCalledWith({
      db: getDb(),
      userId: fixture.user.id,
      inspirationId: insp.id,
    });

    const [storedJob] = await getDb()
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job!.id))
      .limit(1);
    expect(storedJob?.payload).toMatchObject({
      inspirationId: insp.id,
      autoWowGeneration: {
        status: "not_wow",
        generated: false,
        judgment: {
          isWowMoment: false,
          reason: "generic_similarity",
          debugSummary: "Only a generic topical overlap was found.",
        },
      },
    });
    const persistedWowRows = await getDb()
      .select({ id: wowMoments.id })
      .from(wowMoments)
      .where(eq(wowMoments.userId, fixture.user.id));
    expect(persistedWowRows).toHaveLength(0);
  });

  it("does not let automatic WOW provider failures fail the classification job", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "classification success should remain successful",
    });
    const generateAutoWowMoment = vi.fn(async () => {
      throw new Error("runtime provider failure");
    });

    gemini.queueResponse(geminiLabel("loop"));

    await expect(
      runClassificationJob(insp.id, { generateAutoWowMoment }),
    ).resolves.toBeUndefined();

    const after = await loadRow(insp.id);
    expect(after?.cluster).toBe("loop");
    expect(generateAutoWowMoment).toHaveBeenCalledTimes(1);
  });

  it("preserves transient classification retry semantics and skips automatic WOW", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "retry before wow",
    });
    const generateAutoWowMoment = vi.fn();

    gemini.queueResponse(geminiHttpError(503, "service unavailable"));

    await expect(
      runClassificationJob(insp.id, { generateAutoWowMoment }),
    ).rejects.toThrow();
    expect(generateAutoWowMoment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bucket 2 — Cluster assignment persistence
// ---------------------------------------------------------------------------

describe("classifier handler — cluster assignment persistence", () => {
  it("persists cluster + classifiedAt + updatedAt; preserves createdAt", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "a thought folds back on itself",
    });
    const beforeCreatedAt = insp.createdAt.getTime();
    const beforeUpdatedAt = insp.updatedAt.getTime();

    // Pause briefly so the post-update `updatedAt` is strictly later than
    // the seed `updatedAt` even on hosts where `Date.now()` ticks coarsely.
    await new Promise((resolve) => setTimeout(resolve, 10));

    gemini.queueResponse(geminiLabel("loop"));

    const res = await handler(
      makeEvent([{ messageId: "m-persist", body: jobBody(insp.id) }]),
    );
    expect(res.batchItemFailures).toHaveLength(0);

    const after = await loadRow(insp.id);
    expect(after).not.toBeNull();
    expect(after!.cluster).toBe("loop");
    expect(after!.classifiedAt).not.toBeNull();
    // updatedAt advanced; createdAt is immutable across classification.
    expect(after!.updatedAt.getTime()).toBeGreaterThan(beforeUpdatedAt);
    expect(after!.createdAt.getTime()).toBe(beforeCreatedAt);
    // text + userId untouched — the UPDATE is targeted, not a full replace.
    expect(after!.text).toBe("a thought folds back on itself");
    expect(after!.userId).toBe(fixture.user.id);
  });

  it.each(clusterEnumValues)(
    "persists every canonical cluster label: %s",
    async (cluster: Cluster) => {
      // Round-trip every cluster enum value to prove the handler doesn't
      // hard-code any subset. A regression that, say, only writes "loop"
      // would be caught here as five out of six failures.
      const fixture = await createUserFixture(getDb());
      cleanup.trackUser(fixture.user.id);

      const insp = await createInspirationFixture(getDb(), fixture.user.id, {
        text: `seed for ${cluster}`,
      });

      gemini.queueResponse(geminiLabel(cluster));

      const res = await handler(
        makeEvent([
          { messageId: `m-${cluster}`, body: jobBody(insp.id) },
        ]),
      );

      expect(res.batchItemFailures).toHaveLength(0);
      const after = await loadRow(insp.id);
      expect(after?.cluster).toBe(cluster);
      expect(after?.classifiedAt).not.toBeNull();
    },
  );

  it("guards UPDATE with `cluster IS NULL` — does not overwrite a prior label", async () => {
    // Race semantics: two workers may consume a duplicate delivery of the
    // same message. The first writes a label; the second's UPDATE must
    // no-op (because `cluster IS NOT NULL` no longer satisfies the WHERE).
    // We simulate the race by running two records in one batch — between
    // the first record's UPDATE and the second record's SELECT, the row
    // already has a cluster. The handler's already-classified short-circuit
    // catches it without a second Gemini call, but the underlying UPDATE
    // guard is still the safety net.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "duplicate-delivery target",
    });

    gemini.queueResponse(geminiLabel("tension"));

    const res = await handler(
      makeEvent([
        { messageId: "m-dup-a", body: jobBody(insp.id) },
        { messageId: "m-dup-b", body: jobBody(insp.id) },
      ]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    // Exactly ONE Gemini call — the second record short-circuits before
    // the (would-be) second fetch. If both records had gone through, the
    // mock would throw on the empty queue.
    expect(classifierGeminiCalls()).toHaveLength(1);

    const after = await loadRow(insp.id);
    // Final cluster equals the FIRST result, not whatever a second pass
    // might have written — the at-least-once delivery contract is held.
    expect(after?.cluster).toBe("tension");
  });

  it("does not bump updatedAt on the already-classified short-circuit path", async () => {
    // A second consume of an already-classified message must NOT touch the
    // row at all — no UPDATE means `updatedAt` is exactly what it was
    // before the second handler invocation. Otherwise the SPA's "freshness"
    // signals would tick on every retry.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "preserved updatedAt across reruns",
      cluster: "convergence",
      classifiedAt: new Date(),
    });
    const seedUpdatedAt = insp.updatedAt.getTime();

    // Simulate the gap between two legacy compatibility retries.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await handler(
      makeEvent([{ messageId: "m-noop", body: jobBody(insp.id) }]),
    );
    expect(res.batchItemFailures).toHaveLength(0);

    const after = await loadRow(insp.id);
    expect(after?.updatedAt.getTime()).toBe(seedUpdatedAt);
  });
});

// ---------------------------------------------------------------------------
// Bucket 3 — Error handling
// ---------------------------------------------------------------------------

describe("classifier handler — permanent skips (cluster stays NULL, message ack'd)", () => {
  it("Gemini safety block → row stays NULL, no batchItemFailures", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "borderline content",
    });

    gemini.queueResponse(geminiBlock("SAFETY"));

    const res = await handler(
      makeEvent([{ messageId: "m-block", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
    expect(after?.classifiedAt).toBeNull();
  });

  it("out-of-set label → row stays NULL, no batchItemFailures", async () => {
    // The validator MUST reject a label that's not in `clusterEnumValues`.
    // A regression that loosened the validator would let "banana" land in
    // the cluster column, which `pgEnum` would then reject at INSERT time
    // with a confusing 22P02 error. Catch it at the validator instead.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "unusual phrasing",
    });

    gemini.queueResponse(geminiOutOfSet("banana"));

    const res = await handler(
      makeEvent([{ messageId: "m-oos", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
  });

  it("malformed envelope (zod schema fails) → row stays NULL, no retry", async () => {
    // Google could in theory drift the wire shape (drop `candidates`, add
    // a wrapper). Our gemini.ts treats schema-failure as permanent skip
    // because the same input on a retry would be malformed identically.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "drift target",
    });

    gemini.queueResponse(geminiMalformed({ unexpected: "totally different" }));

    const res = await handler(
      makeEvent([{ messageId: "m-malformed", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
  });

  it("empty text in candidate → row stays NULL, no retry", async () => {
    // Pathological 200 OK with no usable text. Same permanent-skip semantics.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "empty-text target",
    });

    // The shared `geminiEmptyText()` helper produces an empty string in
    // parts[0].text; we use a direct discriminated-union form here only to
    // make the intent obvious in test output.
    gemini.queueResponse({ kind: "emptyText" });

    const res = await handler(
      makeEvent([{ messageId: "m-empty", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(0);
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
  });
});

describe("classifier handler — transient failures (batchItemFailures, row stays NULL)", () => {
  it("Gemini HTTP 5xx → batchItemFailures contains the messageId; row NULL", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "flaky day at gemini",
    });

    gemini.queueResponse(geminiHttpError(503, "service unavailable"));

    const res = await handler(
      makeEvent([{ messageId: "m-503", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0]?.itemIdentifier).toBe("m-503");
    const after = await loadRow(insp.id);
    // Row stays NULL — the retry will fill it in.
    expect(after?.cluster).toBeNull();
    expect(after?.classifiedAt).toBeNull();
  });

  it("Gemini HTTP 429 (rate limit) → batchItemFailures; row NULL", async () => {
    // Treat 429 the same as 5xx: caller-bounded transient failure. The current
    // DB-backed worker handles backoff in `background_jobs`.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "rate-limited",
    });

    gemini.queueResponse(geminiHttpError(429, "too many requests"));

    const res = await handler(
      makeEvent([{ messageId: "m-429", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0]?.itemIdentifier).toBe("m-429");
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
  });

  it("network error (fetch rejects) → batchItemFailures; row NULL", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "DNS blip",
    });

    gemini.queueResponse(geminiNetworkError("ECONNRESET"));

    const res = await handler(
      makeEvent([{ messageId: "m-net", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0]?.itemIdentifier).toBe("m-net");
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
  });

  it("non-JSON 200 body → batchItemFailures (loud failure on contract drift)", async () => {
    // `classifyInspirationText` re-throws when `Response.json()` fails.
    // The handler treats throws as transient and adds the messageId to
    // `batchItemFailures`. This is a deliberate "crash loud" legacy-wrapper
    // branch: a permanent contract change should stay visible rather than
    // silently NULL-ing every row.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const insp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "non-json upstream",
    });

    gemini.queueResponse(geminiNonJson("<<<not json>>>"));

    const res = await handler(
      makeEvent([{ messageId: "m-nonjson", body: jobBody(insp.id) }]),
    );

    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0]?.itemIdentifier).toBe("m-nonjson");
    const after = await loadRow(insp.id);
    expect(after?.cluster).toBeNull();
  });

  it("isolates a transient failure to its own messageId in a mixed batch", async () => {
    // A 5xx on one record must NOT prevent the other records from being
    // processed. Legacy partial-batch-response contract.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const okInsp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "should classify cleanly",
    });
    const failInsp = await createInspirationFixture(getDb(), fixture.user.id, {
      text: "will hit a 503",
    });

    // Order matches the records below: ok first, then 503.
    gemini.queueResponse(geminiLabel("morph"));
    gemini.queueResponse(geminiHttpError(503, "down for maintenance"));

    const res = await handler(
      makeEvent([
        { messageId: "m-ok-mix", body: jobBody(okInsp.id) },
        { messageId: "m-fail-mix", body: jobBody(failInsp.id) },
      ]),
    );

    // Only the failing record makes it onto the batch failures list.
    expect(res.batchItemFailures).toHaveLength(1);
    expect(res.batchItemFailures[0]?.itemIdentifier).toBe("m-fail-mix");

    // The successful record's row was updated; the failing record's row
    // remains NULL so a retry can fill it in.
    const okAfter = await loadRow(okInsp.id);
    expect(okAfter?.cluster).toBe("morph");
    const failAfter = await loadRow(failInsp.id);
    expect(failAfter?.cluster).toBeNull();
  });
});
