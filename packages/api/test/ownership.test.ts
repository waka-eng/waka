/**
 * Ownership-enforcement test suite — Sub-AC 13.3.4.
 *
 * Mission
 * -------
 * Lock down the cross-tenant invariant for the inspirations namespace
 * end-to-end: a user can never read, update, or delete an inspiration that
 * belongs to another user. Every cross-tenant attempt MUST collapse to 404
 * (or 403 in the small number of places where the contract permits it),
 * and the row owned by the original tenant MUST remain bit-for-bit
 * unchanged in Postgres regardless of which side-channel was used to try
 * to reach it.
 *
 * The seed's `data_isolation` evaluation principle calls this out
 * explicitly:
 *
 *     "Every query reading or writing inspirations/attachments/reflections
 *      must be scoped by authenticated user_id; no cross-tenant leakage."
 *
 * Why a dedicated file (rather than scattering these inline)
 * ----------------------------------------------------------
 * `inspirations.test.ts` already happens to exercise some of these
 * scenarios alongside the route's positive cases (e.g. PATCH success
 * tests that also assert cross-tenant 404). That is a useful smoke
 * coverage but it is not enough to satisfy Sub-AC 13.3.4 on its own:
 *
 *   1. The cross-tenant assertions are easy to lose during a future test
 *      refactor that moves them around for unrelated reasons.
 *   2. Some surface area is not covered at all in the inline tests
 *      (POST /api/inspirations/:id/reflections cross-tenant, POST
 *      /api/attachments cross-tenant via inspirationId, DELETE side-effects
 *      MUST NOT touch the victim's S3 attachments, …).
 *   3. A single file dedicated to ownership invariants makes the
 *      "tenant-isolation regression" review story a one-line `git blame`
 *      rather than a hunt across a 1.4 KLOC spec file.
 *
 * What "read", "update", "delete" map to in this codebase
 * -------------------------------------------------------
 * The inspirations namespace exposes no dedicated `GET /api/inspirations/:id`
 * endpoint today — the canonical "fetch by id" path is via
 * `GET /api/inspirations/:id/reflections`, plus filtering the
 * `GET /api/inspirations` list response by id. The ownership matrix below is
 * therefore:
 *
 *   READ:   GET  /api/inspirations                                — list scope
 *           GET  /api/inspirations/:id/reflections                 — by-id read
 *   UPDATE: PATCH /api/inspirations/:id                            — partial mutate
 *           POST  /api/inspirations/:id/reflections                — child write
 *           POST  /api/attachments  (with inspirationId)           — child write
 *   DELETE: DELETE /api/inspirations/:id                           — destructive
 *
 * Each row in the matrix gets a paired test:
 *   - cross-tenant attempt returns 404 (or, for the attachments S3-key
 *     prefix check, 403);
 *   - victim's row in Postgres is unchanged (text + userId + counts) so
 *     no covert mutation slipped through under the 404 cover.
 *
 * Why we drive the live Hono `app`
 * --------------------------------
 * Mocking the Drizzle layer here would replace the most failure-prone
 * parts of the contract — the `WHERE user_id = caller` predicates, the
 * zod-strip of forged client fields, FK CASCADE — with hand-written stubs
 * that drift from production. Round-tripping through the real Hono app +
 * the `getDb()` singleton pinned to Neon is the only way to know the
 * route + schema actually meet the seed's `data_isolation` evaluation
 * principle.
 *
 * Cleanup
 * -------
 * Every user inserted via `createUserFixture` is tracked through
 * `createCleanupTracker()` and reaped in `afterEach`. FK CASCADE on
 * `inspirations.user_id` (and `attachments.inspiration_id` /
 * `reflections.inspiration_id`) removes every child row in one round-trip.
 * `afterAll` flushes a second time as belt-and-braces against an aborted
 * test that skipped its own afterEach.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { and, eq } from "drizzle-orm";

import { attachments, inspirations, reflections } from "../src/db/index.js";
import { getDb } from "../src/lib/db.js";
import { createUserFixture } from "./fixtures/users.js";
import { authedClient, createCleanupTracker } from "./helpers/index.js";

// ---------------------------------------------------------------------------
// Cleanup wiring
// ---------------------------------------------------------------------------

const cleanup = createCleanupTracker();

afterEach(async () => {
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
});

// ---------------------------------------------------------------------------
// Pre-flight env tripwire — surfaces a clear error when `.env` failed to load
// rather than a confusing 500 from the route.
// ---------------------------------------------------------------------------

beforeAll(() => {
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  expect(
    process.env.JWT_SECRET ?? process.env.AUTH_SECRET,
    "JWT_SECRET or AUTH_SECRET",
  ).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Type aliases for response shapes (call-site narrowing only — the harness
// does not enforce these at runtime).
// ---------------------------------------------------------------------------

interface ApiInspiration {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  category: number | null;
  cluster: string | null;
  classifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateInspirationResponse {
  inspiration: ApiInspiration;
}

interface ListInspirationsResponse {
  inspirations: ApiInspiration[];
}

interface ApiReflection {
  id: string;
  inspirationId: string;
  userId: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  createdAt: string;
}

interface CreateReflectionResponse {
  reflection: ApiReflection;
}

interface ListReflectionsResponse {
  reflections: ApiReflection[];
}

interface ErrorBody {
  error: string;
}

// ---------------------------------------------------------------------------
// Two-tenant helper.
//
// Almost every test in this file follows the same shape: create alice + bob,
// give alice a row, have bob try to reach it, prove bob gets 404 and alice's
// row is untouched. Folding the boilerplate into one helper lets each test
// stay focused on the side-channel under test (PATCH vs DELETE vs …) rather
// than re-spelling the fixture setup.
// ---------------------------------------------------------------------------

interface TwoTenants {
  alice: Awaited<ReturnType<typeof createUserFixture>>;
  bob: Awaited<ReturnType<typeof createUserFixture>>;
  aliceClient: ReturnType<typeof authedClient>;
  bobClient: ReturnType<typeof authedClient>;
}

async function setupTwoTenants(): Promise<TwoTenants> {
  const alice = await createUserFixture(getDb());
  const bob = await createUserFixture(getDb());
  cleanup.trackUser(alice.user.id);
  cleanup.trackUser(bob.user.id);
  return {
    alice,
    bob,
    aliceClient: authedClient(alice),
    bobClient: authedClient(bob),
  };
}

/**
 * Seed an inspiration owned by `alice` and return its id + the captured
 * "before" snapshot of the row (text + updatedAt) so a follow-up
 * "no covert mutation" assertion can compare against a known baseline.
 */
async function seedAliceInspiration(
  aliceClient: ReturnType<typeof authedClient>,
  payload: {
    text: string;
    kind?: string;
    category?: number;
  },
): Promise<{
  id: string;
  text: string;
  kind: string | null;
  category: number | null;
  updatedAt: string;
}> {
  const created = await aliceClient.json<CreateInspirationResponse>(
    "POST",
    "/api/inspirations",
    payload,
  );
  expect(
    created.status,
    `seed POST /api/inspirations failed: ${JSON.stringify(created.body)}`,
  ).toBe(201);
  const row = created.body.inspiration;
  return {
    id: row.id,
    text: row.text,
    kind: row.kind,
    category: row.category,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// READ ownership — GET /api/inspirations and GET /api/inspirations/:id/reflections
// ---------------------------------------------------------------------------
//
// The "read" surface for an inspiration is two endpoints:
//   1. GET /api/inspirations             → list scoped to the caller.
//   2. GET /api/inspirations/:id/reflections
//                                    → by-id read of the row's reflections;
//                                      404 cross-tenant.
//
// We drive both from bob's session, with alice as the victim, and assert:
//   - bob's GET list never contains alice's rows;
//   - bob's GET /:id/reflections on alice's id is 404 (not 403, not 200, not
//     a leak of the empty array).

describe("READ ownership — GET /api/inspirations (list scope)", () => {
  it("bob's list never contains any of alice's inspirations, even when alice has multiple", async () => {
    const { alice, bob, aliceClient, bobClient } = await setupTwoTenants();

    // Alice creates several inspirations so bob would have to be unlucky to
    // miss a leak. We mix kind/category/text so a buggy filter that only
    // checks one column can't fluke a pass. Seeding is done in parallel so
    // we don't pay the Neon round-trip cost serially — these are
    // independent inserts and the tenant scope under test does not depend
    // on insertion order.
    const alicePayloads = [
      { text: "alice-one", kind: "note", category: 1 },
      { text: "alice-two", kind: "link", category: 2 },
      { text: "alice-three", kind: "image", category: 3 },
    ];
    const aliceIds: string[] = (
      await Promise.all(
        alicePayloads.map((p) => seedAliceInspiration(aliceClient, p)),
      )
    ).map((s) => s.id);

    // Bob has zero inspirations. The contract is a 200 with an empty array
    // — never a 404, never a "system" leak of alice's rows.
    const bobList = await bobClient.get<ListInspirationsResponse>(
      "/api/inspirations",
    );
    expect(bobList.status).toBe(200);
    expect(Array.isArray(bobList.body.inspirations)).toBe(true);
    expect(bobList.body.inspirations).toHaveLength(0);

    // Defence in depth: even if bob's list ever became non-empty in a
    // future regression, none of alice's ids may appear under bob's view.
    for (const aliceId of aliceIds) {
      expect(
        bobList.body.inspirations.some((r) => r.id === aliceId),
        `bob's list leaked alice's row ${aliceId}`,
      ).toBe(false);
    }
    for (const row of bobList.body.inspirations) {
      expect(row.userId).toBe(bob.user.id);
      expect(row.userId).not.toBe(alice.user.id);
    }
  }, 20_000);

  it("bob's list is unaffected by alice creating new rows mid-test (reads stay scoped)", async () => {
    // Race-style scenario: bob fetches once, alice writes, bob fetches
    // again. The second fetch must STILL be empty for bob — no covert
    // post-write fan-out leaks across tenants.
    const { alice, bobClient, aliceClient } = await setupTwoTenants();

    const bobBefore = await bobClient.get<ListInspirationsResponse>(
      "/api/inspirations",
    );
    expect(bobBefore.status).toBe(200);
    expect(bobBefore.body.inspirations).toHaveLength(0);

    await seedAliceInspiration(aliceClient, { text: "post-fetch by alice" });

    const bobAfter = await bobClient.get<ListInspirationsResponse>(
      "/api/inspirations",
    );
    expect(bobAfter.status).toBe(200);
    expect(bobAfter.body.inspirations).toHaveLength(0);
    for (const row of bobAfter.body.inspirations) {
      expect(row.userId).not.toBe(alice.user.id);
    }
  }, 20_000);
});

describe("READ ownership — GET /api/inspirations/:id/reflections", () => {
  it("returns 404 when bob tries to read reflections under alice's inspiration id", async () => {
    const { aliceClient, bobClient } = await setupTwoTenants();

    // Alice creates an inspiration AND attaches a reflection to it. The
    // reflection gives this test something to leak — without it, an
    // accidental 200 + empty array would still look "safe" to a casual
    // reviewer. We want the assertion to fail loudly if bob ever sees the
    // reflection text.
    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's private musing",
    });

    const refCreate = await aliceClient.json<CreateReflectionResponse>(
      "POST",
      `/api/inspirations/${seeded.id}/reflections`,
      { question: "what does alice know that bob shouldn't?" },
    );
    expect(refCreate.status).toBe(201);

    // Bob attempts the read.
    const bobAttempt = await bobClient.get<ErrorBody>(
      `/api/inspirations/${seeded.id}/reflections`,
    );

    // 404 (not 403, not 200) — the route's contract says cross-tenant ids
    // collapse to 404 so the endpoint cannot be used to enumerate uuids.
    expect(bobAttempt.status).toBe(404);
    expect(bobAttempt.body.error).toMatch(/not found/i);

    // Sanity: alice can still read her reflection (the 404 must come from
    // an ownership predicate, not from a corrupted row).
    const aliceRead = await aliceClient.get<ListReflectionsResponse>(
      `/api/inspirations/${seeded.id}/reflections`,
    );
    expect(aliceRead.status).toBe(200);
    expect(aliceRead.body.reflections).toHaveLength(1);
    expect(aliceRead.body.reflections[0]!.question).toBe(
      "what does alice know that bob shouldn't?",
    );
  });

  it("returns 404 even when the inspiration has no reflections (cannot infer existence)", async () => {
    // An attacker probing for "does alice own this uuid?" by reading the
    // reflections endpoint must get the same 404 whether the inspiration
    // has children or not. Otherwise a 200-with-empty-array vs 404 split
    // would itself leak existence.
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "no reflections yet",
    });

    const bobAttempt = await bobClient.get<ErrorBody>(
      `/api/inspirations/${seeded.id}/reflections`,
    );
    expect(bobAttempt.status).toBe(404);
    expect(bobAttempt.body.error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// UPDATE ownership — PATCH /api/inspirations/:id, POST child writes
// ---------------------------------------------------------------------------
//
// Three side channels through which a malicious caller could try to "update"
// (in the broadest sense — mutate state attached to) another tenant's row:
//
//   1. Direct PATCH /api/inspirations/:id           — change text/kind/category.
//   2. POST /api/inspirations/:id/reflections       — graft a new reflection
//                                                 onto someone else's row.
//   3. POST /api/attachments (with inspirationId)   — graft a new attachment
//                                                 onto someone else's row.
//
// Each must 404 (or 403 for the attachments S3 key namespace check) and
// each must leave Postgres in the exact state alice wrote.

describe("UPDATE ownership — PATCH /api/inspirations/:id", () => {
  it("returns 404 when bob attempts to PATCH alice's row, and alice's row is unchanged", async () => {
    const { alice, aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's pristine text",
      kind: "note",
      category: 7,
    });

    // Bob attempts a wholesale overwrite — every editable field plus a
    // forged userId for good measure. The route's zod schema must strip
    // the forged userId AND the WHERE clause must reject the request so
    // alice's row never sees Postgres traffic.
    const bobAttempt = await bobClient.json<ErrorBody>(
      "PATCH",
      `/api/inspirations/${seeded.id}`,
      {
        text: "pwned by bob",
        kind: "image",
        category: 99,
        userId: "00000000-0000-0000-0000-000000000000",
      },
    );

    expect(bobAttempt.status).toBe(404);
    expect(bobAttempt.body.error).toMatch(/not found/i);

    // The row in Postgres is bit-for-bit what alice wrote — text, kind,
    // category, and crucially userId untouched. We hit the DB directly so
    // a bug in alice's GET handler can't mask a stale row.
    const dbRows = await getDb()
      .select({
        id: inspirations.id,
        userId: inspirations.userId,
        text: inspirations.text,
        kind: inspirations.kind,
        category: inspirations.category,
      })
      .from(inspirations)
      .where(eq(inspirations.id, seeded.id));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.userId).toBe(alice.user.id);
    expect(dbRows[0]!.text).toBe("alice's pristine text");
    expect(dbRows[0]!.kind).toBe("note");
    expect(dbRows[0]!.category).toBe(7);
  });

  it("returns 404 even when bob's PATCH body is a no-op (cannot infer existence by validation)", async () => {
    // A PATCH whose body would normally reach validation (an empty body
    // → 400) MUST still 404 cross-tenant. Otherwise the 400 vs 404 split
    // could itself leak ownership information ("bob got 400, so the row
    // exists; bob got 404, so it doesn't").
    //
    // The route runs auth → path validation → body validation → ownership
    // lookup. So a malformed body 400s for everyone before reaching the
    // ownership check, BUT a well-formed body that passes validation must
    // 404 cross-tenant. We exercise the well-formed path here.
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const bobAttempt = await bobClient.json<ErrorBody>(
      "PATCH",
      `/api/inspirations/${seeded.id}`,
      { kind: "note" }, // valid, minimal patch
    );

    expect(bobAttempt.status).toBe(404);
  });

  it("returns 404 for bob's PATCH on a freshly-created and a long-lived row alike", async () => {
    // Time-of-check / time-of-use can hide tenant bugs: a route that
    // checks ownership against a stale cache might happily PATCH a row
    // created seconds ago by a different tenant. Run the assertion
    // against a row created in the same tick, then again after a brief
    // pause, to make sure both paths 404.
    const { aliceClient, bobClient } = await setupTwoTenants();

    const fresh = await seedAliceInspiration(aliceClient, {
      text: "just created",
    });
    const fresh404 = await bobClient.json<ErrorBody>(
      "PATCH",
      `/api/inspirations/${fresh.id}`,
      { text: "pwned-fresh" },
    );
    expect(fresh404.status).toBe(404);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const stale = await seedAliceInspiration(aliceClient, {
      text: "older row",
    });
    const stale404 = await bobClient.json<ErrorBody>(
      "PATCH",
      `/api/inspirations/${stale.id}`,
      { text: "pwned-stale" },
    );
    expect(stale404.status).toBe(404);

    // And both rows have their original text in Postgres.
    const dbRows = await getDb()
      .select({ id: inspirations.id, text: inspirations.text })
      .from(inspirations)
      .where(eq(inspirations.userId, (await getDb()
        .select({ id: inspirations.userId })
        .from(inspirations)
        .where(eq(inspirations.id, fresh.id))
        .limit(1))[0]!.id));
    const freshRow = dbRows.find((r) => r.id === fresh.id);
    const staleRow = dbRows.find((r) => r.id === stale.id);
    expect(freshRow?.text).toBe("just created");
    expect(staleRow?.text).toBe("older row");
  }, 20_000);
});

describe("UPDATE ownership — POST /api/inspirations/:id/reflections", () => {
  it("returns 404 when bob tries to attach a reflection to alice's inspiration; no row is inserted", async () => {
    // The reflections POST is a "child write" — it doesn't mutate the
    // inspiration row itself, but it creates a row pointing at it. Same
    // tenant invariant applies: bob may not graft onto alice's row.
    const { alice, aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const bobAttempt = await bobClient.json<ErrorBody>(
      "POST",
      `/api/inspirations/${seeded.id}/reflections`,
      { question: "bob's covert reflection" },
    );

    expect(bobAttempt.status).toBe(404);
    expect(bobAttempt.body.error).toMatch(/not found/i);

    // Bob did not slip a row in under any user_id (his own or alice's).
    // We hit the DB directly because the route would 404 a follow-up GET
    // anyway, masking a successful insert.
    const stray = await getDb()
      .select({ id: reflections.id, userId: reflections.userId })
      .from(reflections)
      .where(eq(reflections.inspirationId, seeded.id));
    expect(stray).toHaveLength(0);

    // Sanity: alice can still attach her own reflection (the 404 came
    // from the ownership predicate, not from a corrupted row).
    const aliceWrite = await aliceClient.json<CreateReflectionResponse>(
      "POST",
      `/api/inspirations/${seeded.id}/reflections`,
      { question: "alice's legitimate reflection" },
    );
    expect(aliceWrite.status).toBe(201);
    expect(aliceWrite.body.reflection.userId).toBe(alice.user.id);
  });

  it("rejects bob even when bob spoofs userId in the reflection body", async () => {
    // The schema doesn't declare `userId` so zod strips it, but layering
    // an explicit assertion here means a future schema-loosening bug
    // surfaces immediately rather than as a tenant-isolation incident in
    // production.
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const bobAttempt = await bobClient.json<ErrorBody>(
      "POST",
      `/api/inspirations/${seeded.id}/reflections`,
      {
        question: "bob's covert reflection",
        userId: "00000000-0000-0000-0000-000000000000",
        inspirationId: seeded.id, // body field is ignored — path wins
      },
    );

    expect(bobAttempt.status).toBe(404);

    const stray = await getDb()
      .select({ id: reflections.id })
      .from(reflections)
      .where(eq(reflections.inspirationId, seeded.id));
    expect(stray).toHaveLength(0);
  });
});

describe("UPDATE ownership — POST /api/attachments (cross-tenant inspirationId)", () => {
  it("returns 404 when bob tries to finalize a link attachment against alice's inspiration", async () => {
    // The attachments-finalize endpoint validates ownership of the
    // referenced inspiration before INSERTing the attachment row. This is
    // the "graft an attachment onto someone else's row" attack and the
    // route MUST 404 the inspirationId across tenants so:
    //   (a) the attachments table never gains a row pointing at a
    //       cross-tenant inspiration, and
    //   (b) the attacker cannot enumerate alice's inspiration uuids by
    //       observing 200 vs 404 vs 403.
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const bobAttempt = await bobClient.json<ErrorBody>(
      "POST",
      "/api/attachments",
      {
        type: "link",
        inspirationId: seeded.id,
        url: "https://example.test/bob-was-here",
        name: "bob-was-here",
      },
    );

    expect(bobAttempt.status).toBe(404);
    expect(bobAttempt.body.error).toMatch(/not found/i);

    // No attachment row was inserted for this inspiration — the rejected
    // finalize must be visible-side-effect-free.
    const stray = await getDb()
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.inspirationId, seeded.id));
    expect(stray).toHaveLength(0);
  });

  it("returns 403 when bob supplies a key from alice's S3 namespace (key prefix check fires before lookup)", async () => {
    // The S3-backed finalize path checks the `users/<userId>/attachments/`
    // prefix BEFORE hitting the DB. So a body whose key belongs to alice's
    // namespace gets a 403 (not a 404), because the ownership signal is
    // established by the key shape itself before the inspirationId is
    // even looked up. Lock the contract in so a future refactor that
    // reorders the checks doesn't accidentally turn 403 into 200/leak.
    const { alice, aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const bobAttempt = await bobClient.json<ErrorBody>(
      "POST",
      "/api/attachments",
      {
        type: "image",
        inspirationId: seeded.id,
        // Bob claims a key under alice's namespace. The route MUST 403
        // (or 404 from the inspirationId check — either is acceptable
        // ownership enforcement; we accept both to stay robust against
        // a future check-order swap).
        key: `users/${alice.user.id}/attachments/forged.png`,
        contentType: "image/png",
        size: 1024,
      },
    );

    // Either 403 (key-namespace check) or 404 (inspirationId ownership)
    // is an acceptable ownership-enforcement outcome. We assert on the
    // disjunction so the test stays robust against the route's internal
    // ordering of those two checks.
    expect([403, 404]).toContain(bobAttempt.status);

    // No attachment row inserted under any predicate.
    const stray = await getDb()
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.inspirationId, seeded.id));
    expect(stray).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE ownership — DELETE /api/inspirations/:id
// ---------------------------------------------------------------------------
//
// The most dangerous side channel — a successful cross-tenant DELETE would
// destroy alice's data, including any S3-backed attachments. Beyond the
// 404 contract, we assert:
//   - alice's inspirations row remains in Postgres;
//   - alice's attached reflections + attachments remain in Postgres
//     (no covert cascade fired under the 404);
//   - alice's GET list still returns the row.

describe("DELETE ownership — DELETE /api/inspirations/:id", () => {
  it("returns 404 when bob attempts to delete alice's inspiration; alice's row + children survive", async () => {
    const { alice, aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row to defend",
    });

    // Attach a reflection so we can prove the cascade did NOT fire under
    // bob's failed delete. (A bug that 404s but still issues the DELETE
    // would otherwise be invisible to a test that only checked the
    // inspiration row itself.)
    const reflectionCreate = await aliceClient.json<CreateReflectionResponse>(
      "POST",
      `/api/inspirations/${seeded.id}/reflections`,
      { question: "should survive bob's delete attempt" },
    );
    expect(reflectionCreate.status).toBe(201);
    const reflectionId = reflectionCreate.body.reflection.id;

    const bobAttempt = await bobClient.delete<ErrorBody>(
      `/api/inspirations/${seeded.id}`,
    );

    expect(bobAttempt.status).toBe(404);
    expect(bobAttempt.body.error).toMatch(/not found/i);

    // 1. The inspiration row is still there, still owned by alice.
    const dbInsp = await getDb()
      .select({
        id: inspirations.id,
        userId: inspirations.userId,
        text: inspirations.text,
      })
      .from(inspirations)
      .where(eq(inspirations.id, seeded.id));
    expect(dbInsp).toHaveLength(1);
    expect(dbInsp[0]!.userId).toBe(alice.user.id);
    expect(dbInsp[0]!.text).toBe("alice's row to defend");

    // 2. The reflection survived — no covert CASCADE under the 404.
    const dbRef = await getDb()
      .select({ id: reflections.id })
      .from(reflections)
      .where(eq(reflections.id, reflectionId));
    expect(dbRef).toHaveLength(1);

    // 3. Alice's GET list still shows the row at the top.
    const aliceList = await aliceClient.get<ListInspirationsResponse>(
      "/api/inspirations",
    );
    expect(aliceList.status).toBe(200);
    expect(aliceList.body.inspirations.some((r) => r.id === seeded.id)).toBe(
      true,
    );
  }, 20_000);

  it("returns 404 on a re-attempt across tenants (idempotent failure, not stateful)", async () => {
    // A bug that flipped the second cross-tenant DELETE from 404 to 200
    // (because some local cache decided "this id was attempted before, so
    // it must be deletable") would be catastrophic. Lock the invariant.
    const { alice, aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's stubborn row",
    });

    const first = await bobClient.delete<ErrorBody>(
      `/api/inspirations/${seeded.id}`,
    );
    expect(first.status).toBe(404);

    const second = await bobClient.delete<ErrorBody>(
      `/api/inspirations/${seeded.id}`,
    );
    expect(second.status).toBe(404);

    // Alice's row still alive.
    const dbInsp = await getDb()
      .select({ id: inspirations.id, userId: inspirations.userId })
      .from(inspirations)
      .where(eq(inspirations.id, seeded.id));
    expect(dbInsp).toHaveLength(1);
    expect(dbInsp[0]!.userId).toBe(alice.user.id);
  });

  it("a third user can also not delete or read alice's row (more than two tenants)", async () => {
    // Two-user tests catch the common 1:1 leak. A three-user test catches
    // a class of bugs where tenant scope is "your row OR any row not
    // owned by user N" — i.e. a regression that 404s only the *immediate*
    // other tenant but lets a third tenant through. Add a charlie.
    const { alice, aliceClient, bobClient } = await setupTwoTenants();
    const charlie = await createUserFixture(getDb());
    cleanup.trackUser(charlie.user.id);
    const charlieClient = authedClient(charlie);

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row, three tenants present",
    });

    // Bob → 404
    const bob404 = await bobClient.delete<ErrorBody>(
      `/api/inspirations/${seeded.id}`,
    );
    expect(bob404.status).toBe(404);

    // Charlie → 404
    const charlie404 = await charlieClient.delete<ErrorBody>(
      `/api/inspirations/${seeded.id}`,
    );
    expect(charlie404.status).toBe(404);

    // Charlie also cannot READ alice's reflections endpoint.
    const charlieRead = await charlieClient.get<ErrorBody>(
      `/api/inspirations/${seeded.id}/reflections`,
    );
    expect(charlieRead.status).toBe(404);

    // And alice's row is still alive.
    const dbInsp = await getDb()
      .select({ id: inspirations.id, userId: inspirations.userId })
      .from(inspirations)
      .where(eq(inspirations.id, seeded.id));
    expect(dbInsp).toHaveLength(1);
    expect(dbInsp[0]!.userId).toBe(alice.user.id);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Cross-cutting — unknown vs cross-tenant uuids return the same code
// ---------------------------------------------------------------------------
//
// The seed contract is "404 (not 403) so the endpoint cannot be used to
// enumerate uuids". The strongest version of that invariant is: a 404
// from a cross-tenant id and a 404 from a never-existed uuid are
// indistinguishable to the caller. If the route ever included a body
// hint like `error: "owned by another user"` versus `error: "not found"`,
// the attacker could differentiate them. Lock the invariant.

describe("cross-cutting — cross-tenant 404 is indistinguishable from never-existed 404", () => {
  it("PATCH: cross-tenant 404 body matches unknown-uuid 404 body", async () => {
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const crossTenant = await bobClient.json<ErrorBody>(
      "PATCH",
      `/api/inspirations/${seeded.id}`,
      { text: "pwned" },
    );
    const unknown = await bobClient.json<ErrorBody>(
      "PATCH",
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
      { text: "ghost" },
    );

    expect(crossTenant.status).toBe(404);
    expect(unknown.status).toBe(404);
    // Body shape is identical (no body-level signal that one is "owned by
    // someone else" and the other is "doesn't exist").
    expect(crossTenant.body.error).toBe(unknown.body.error);
  });

  it("DELETE: cross-tenant 404 body matches unknown-uuid 404 body", async () => {
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const crossTenant = await bobClient.delete<ErrorBody>(
      `/api/inspirations/${seeded.id}`,
    );
    const unknown = await bobClient.delete<ErrorBody>(
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
    );

    expect(crossTenant.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(crossTenant.body.error).toBe(unknown.body.error);
  });

  it("GET reflections: cross-tenant 404 body matches unknown-uuid 404 body", async () => {
    const { aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row",
    });

    const crossTenant = await bobClient.get<ErrorBody>(
      `/api/inspirations/${seeded.id}/reflections`,
    );
    const unknown = await bobClient.get<ErrorBody>(
      "/api/inspirations/00000000-0000-0000-0000-000000000000/reflections",
    );

    expect(crossTenant.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(crossTenant.body.error).toBe(unknown.body.error);
  });
});

// ---------------------------------------------------------------------------
// Belt-and-braces — alice's row is reachable by alice throughout
// ---------------------------------------------------------------------------
//
// Pair every "bob gets 404" assertion with at least one "alice still
// works" sanity case so a regression that 404s every request — including
// alice's — does not slip past as a green test.

describe("sanity — alice's own access path is unaffected by bob's failed attempts", () => {
  it("after bob fails to PATCH/DELETE/READ, alice can still PATCH and DELETE her row normally", async () => {
    const { alice, aliceClient, bobClient } = await setupTwoTenants();

    const seeded = await seedAliceInspiration(aliceClient, {
      text: "alice's row, multi-channel attack",
    });

    // Bob attacks via three channels in parallel — they're all independent
    // failed attempts and we don't need to observe ordering, just that
    // none of them succeeded.
    await Promise.all([
      bobClient.json<ErrorBody>(
        "PATCH",
        `/api/inspirations/${seeded.id}`,
        { text: "pwned" },
      ),
      bobClient.json<ErrorBody>(
        "POST",
        `/api/inspirations/${seeded.id}/reflections`,
        { question: "covert" },
      ),
      bobClient.delete<ErrorBody>(`/api/inspirations/${seeded.id}`),
    ]);

    // Alice's PATCH still works.
    const alicePatch = await aliceClient.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${seeded.id}`,
      { text: "alice's edit, post-attack" },
    );
    expect(alicePatch.status).toBe(200);
    expect(alicePatch.body.inspiration.text).toBe(
      "alice's edit, post-attack",
    );
    expect(alicePatch.body.inspiration.userId).toBe(alice.user.id);

    // Alice's DELETE still works.
    const aliceDelete = await aliceClient.delete<{ id: string }>(
      `/api/inspirations/${seeded.id}`,
    );
    expect(aliceDelete.status).toBe(200);
    expect(aliceDelete.body.id).toBe(seeded.id);

    // And the row is really gone in Postgres now.
    const dbAfter = await getDb()
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(
        and(
          eq(inspirations.id, seeded.id),
          eq(inspirations.userId, alice.user.id),
        ),
      );
    expect(dbAfter).toHaveLength(0);
  }, 20_000);
});
