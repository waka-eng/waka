/**
 * Standalone smoke test for POST /inspirations/:id/reflections.
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/routes/reflections.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Creates two throw-away users,
 * exercises the reflections endpoint, then cleans up. Mirrors the style of
 * `inspirations.smoke.ts`.
 *
 * What we cover (POST):
 *   1. 401 when unauthenticated.
 *   2. 400 on a malformed inspiration id (not a uuid).
 *   3. 400 on missing/empty `question`.
 *   4. 404 when the inspiration is owned by another user (cross-tenant).
 *   5. 404 when the inspiration does not exist at all.
 *   6. 201 happy path — full row returned, question/answer/skipped echoed,
 *      `userId` taken from auth context, `inspirationId` taken from URL.
 *   7. 201 when `skipped=true` with no answer (deliberate skip is a valid
 *      persistent state distinct from "answer is null pending").
 *
 * What we cover (GET):
 *   8.  401 when unauthenticated.
 *   9.  400 on a malformed inspiration id.
 *   10. 404 when the inspiration belongs to another user (cross-tenant).
 *   11. 404 when the inspiration does not exist at all.
 *   12. 200 happy path — returns reflections owned by caller, ordered by
 *       `created_at` ascending; cross-tenant rows do not leak.
 *   13. 200 with empty array when the caller owns an inspiration with no
 *       reflections yet.
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { inspirations, reflections, users } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { app } from "../index.js";

async function signupTestUser(label: string) {
  const email = `reflections-smoke-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const password = "supersecret123";
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: `Refl Smoke ${label}` }),
  });
  if (signup.status !== 201) {
    throw new Error(`Signup failed: ${signup.status} ${await signup.text()}`);
  }
  return (await signup.json()) as {
    user: { id: string; email: string; name: string };
    token: string;
  };
}

async function createInspiration(token: string, text: string) {
  const r = await app.request("/inspirations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
  if (r.status !== 201) {
    throw new Error(
      `Failed to create inspiration: ${r.status} ${await r.text()}`,
    );
  }
  return (await r.json()) as { inspiration: { id: string; userId: string } };
}

async function main() {
  const { user, token } = await signupTestUser("a");
  const { user: userB, token: tokenB } = await signupTestUser("b");

  // Pre-seed: each user owns one inspiration we can attach reflections to.
  const { inspiration: inspA } = await createInspiration(token, "A's spark");
  const { inspiration: inspB } = await createInspiration(tokenB, "B's spark");

  try {
    // 1. Unauthenticated → 401.
    const noAuth = await app.request(
      `/inspirations/${inspA.id}/reflections`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "why?" }),
      },
    );
    if (noAuth.status !== 401) {
      throw new Error(`Expected 401 without auth, got ${noAuth.status}`);
    }
    console.log("[1/13] unauthenticated → 401 ✅");

    // 2. Malformed uuid → 400.
    const badId = await app.request(
      "/inspirations/not-a-uuid/reflections",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: "why?" }),
      },
    );
    if (badId.status !== 400) {
      throw new Error(`Expected 400 on malformed id, got ${badId.status}`);
    }
    console.log("[2/13] malformed uuid → 400 ✅");

    // 3. Missing question → 400.
    const noQ = await app.request(
      `/inspirations/${inspA.id}/reflections`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (noQ.status !== 400) {
      throw new Error(`Expected 400 on missing question, got ${noQ.status}`);
    }
    console.log("[3/13] missing question → 400 ✅");

    // 4. Cross-tenant → 404 (NOT 403; never leak existence).
    const cross = await app.request(
      `/inspirations/${inspB.id}/reflections`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: "trying to attach to B's row" }),
      },
    );
    if (cross.status !== 404) {
      throw new Error(`Expected 404 cross-tenant, got ${cross.status}`);
    }
    console.log("[4/13] cross-tenant → 404 ✅");

    // 5. Non-existent inspiration → 404.
    const ghost = await app.request(
      "/inspirations/00000000-0000-0000-0000-000000000000/reflections",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: "no such row" }),
      },
    );
    if (ghost.status !== 404) {
      throw new Error(`Expected 404 missing row, got ${ghost.status}`);
    }
    console.log("[5/13] non-existent inspiration → 404 ✅");

    // 6. Happy path with answer.
    const ok = await app.request(
      `/inspirations/${inspA.id}/reflections`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: "  what is the smallest valid step? ",
          answer: " ship the migration first ",
        }),
      },
    );
    if (ok.status !== 201) {
      throw new Error(`Expected 201, got ${ok.status}: ${await ok.text()}`);
    }
    const okBody = (await ok.json()) as {
      reflection: {
        id: string;
        inspirationId: string;
        userId: string;
        question: string;
        answer: string | null;
        skipped: boolean;
        createdAt: string;
      };
    };
    const r = okBody.reflection;
    if (r.inspirationId !== inspA.id) {
      throw new Error(`inspirationId mismatch: ${r.inspirationId} vs ${inspA.id}`);
    }
    if (r.userId !== user.id) {
      throw new Error(`userId mismatch: ${r.userId} vs ${user.id}`);
    }
    if (r.question !== "what is the smallest valid step?") {
      throw new Error(`question not trimmed: ${JSON.stringify(r.question)}`);
    }
    if (r.answer !== "ship the migration first") {
      throw new Error(`answer not trimmed: ${JSON.stringify(r.answer)}`);
    }
    if (r.skipped !== false) {
      throw new Error(`skipped should default to false, got ${r.skipped}`);
    }
    console.log("[6/13] happy path → 201 with full row ✅");

    // 7. Skipped state with no answer.
    const skipped = await app.request(
      `/inspirations/${inspA.id}/reflections`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: "want to journal on this?",
          skipped: true,
        }),
      },
    );
    if (skipped.status !== 201) {
      throw new Error(
        `Expected 201 for skipped reflection, got ${skipped.status}`,
      );
    }
    const skippedBody = (await skipped.json()) as {
      reflection: { skipped: boolean; answer: string | null };
    };
    if (skippedBody.reflection.skipped !== true) {
      throw new Error(
        `skipped flag not persisted: ${skippedBody.reflection.skipped}`,
      );
    }
    if (skippedBody.reflection.answer !== null) {
      throw new Error(
        `answer should be null on skip, got ${skippedBody.reflection.answer}`,
      );
    }
    console.log("[7/13] skipped reflection → 201 with skipped=true ✅");

    // -----------------------------------------------------------------
    // GET /inspirations/:id/reflections
    // -----------------------------------------------------------------

    // 8. Unauthenticated GET → 401.
    const getNoAuth = await app.request(
      `/inspirations/${inspA.id}/reflections`,
      { method: "GET" },
    );
    if (getNoAuth.status !== 401) {
      throw new Error(
        `GET expected 401 without auth, got ${getNoAuth.status}`,
      );
    }
    console.log("[8/13] GET unauthenticated → 401 ✅");

    // 9. Malformed uuid → 400.
    const getBadId = await app.request("/inspirations/not-a-uuid/reflections", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (getBadId.status !== 400) {
      throw new Error(`GET expected 400 on bad id, got ${getBadId.status}`);
    }
    console.log("[9/13] GET malformed uuid → 400 ✅");

    // 10. Cross-tenant → 404 (NOT 403; never leak existence). Token A is
    //     trying to read reflections under inspiration B.
    const getCross = await app.request(
      `/inspirations/${inspB.id}/reflections`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (getCross.status !== 404) {
      throw new Error(
        `GET expected 404 cross-tenant, got ${getCross.status}`,
      );
    }
    console.log("[10/13] GET cross-tenant → 404 ✅");

    // 11. Non-existent inspiration → 404.
    const getGhost = await app.request(
      "/inspirations/00000000-0000-0000-0000-000000000000/reflections",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (getGhost.status !== 404) {
      throw new Error(
        `GET expected 404 for missing row, got ${getGhost.status}`,
      );
    }
    console.log("[11/13] GET non-existent inspiration → 404 ✅");

    // 12. Happy path. User A's inspiration has 2 reflections by now (steps
    //     6 and 7); they should be returned in ascending created_at order.
    //     Tenant isolation: nothing from user B can leak in.
    const list = await app.request(
      `/inspirations/${inspA.id}/reflections`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (list.status !== 200) {
      throw new Error(
        `GET expected 200 happy path, got ${list.status}: ${await list.text()}`,
      );
    }
    const listBody = (await list.json()) as {
      reflections: Array<{
        id: string;
        inspirationId: string;
        userId: string;
        question: string;
        answer: string | null;
        skipped: boolean;
        createdAt: string;
      }>;
    };
    if (!Array.isArray(listBody.reflections)) {
      throw new Error("GET response.reflections is not an array");
    }
    if (listBody.reflections.length !== 2) {
      throw new Error(
        `GET expected 2 reflections, got ${listBody.reflections.length}`,
      );
    }
    for (const refl of listBody.reflections) {
      if (refl.inspirationId !== inspA.id) {
        throw new Error(
          `GET inspirationId mismatch: ${refl.inspirationId} vs ${inspA.id}`,
        );
      }
      if (refl.userId !== user.id) {
        throw new Error(
          `GET tenant leak: reflection.userId=${refl.userId} vs caller=${user.id}`,
        );
      }
    }
    const t0 = new Date(listBody.reflections[0]!.createdAt).getTime();
    const t1 = new Date(listBody.reflections[1]!.createdAt).getTime();
    if (!(t0 <= t1)) {
      throw new Error(
        `GET expected ascending order by createdAt, got ${t0} > ${t1}`,
      );
    }
    // The first reflection authored had a question about "smallest valid step";
    // the second was the explicit-skip "want to journal" question. Order check.
    if (
      !listBody.reflections[0]!.question.startsWith("what is the smallest")
    ) {
      throw new Error(
        `GET expected first reflection to be the answered one, got: ${listBody.reflections[0]!.question}`,
      );
    }
    if (listBody.reflections[1]!.skipped !== true) {
      throw new Error(
        `GET expected second reflection to be the skipped one, got skipped=${listBody.reflections[1]!.skipped}`,
      );
    }
    console.log(
      "[12/13] GET happy path → 200 with reflections ordered by createdAt asc ✅",
    );

    // 13. Empty list — user B owns inspB but has no reflections on it.
    const empty = await app.request(
      `/inspirations/${inspB.id}/reflections`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenB}` },
      },
    );
    if (empty.status !== 200) {
      throw new Error(
        `GET expected 200 for empty list, got ${empty.status}`,
      );
    }
    const emptyBody = (await empty.json()) as {
      reflections: unknown[];
    };
    if (!Array.isArray(emptyBody.reflections) || emptyBody.reflections.length !== 0) {
      throw new Error(
        `GET expected empty array, got: ${JSON.stringify(emptyBody)}`,
      );
    }
    console.log("[13/13] GET empty list → 200 with [] ✅");
  } finally {
    // Cleanup: reflections cascade with inspiration cascade with user.
    const db = getDb();
    await db.delete(reflections).where(eq(reflections.userId, user.id));
    await db.delete(reflections).where(eq(reflections.userId, userB.id));
    await db.delete(inspirations).where(eq(inspirations.userId, user.id));
    await db.delete(inspirations).where(eq(inspirations.userId, userB.id));
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(users).where(eq(users.id, userB.id));
    console.log("cleaned up test users + inspirations + reflections");
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
