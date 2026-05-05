/**
 * Standalone smoke test for POST /inspirations and GET /inspirations.
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/routes/inspirations.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Creates two throw-away users via
 * /auth/signup, exercises the inspirations endpoints with each user's token,
 * then cleans up the inspiration rows + the users. Does not depend on the
 * vitest harness — this is the same one-off-script style used elsewhere in
 * `packages/api/src/routes` while the proper test suite is built out.
 *
 * What we cover:
 *   1. 401 when unauthenticated (POST).
 *   2. 201 + row returned when authenticated, with `cluster` left NULL
 *      (the classifier worker is responsible for filling it).
 *   3. 400 on missing/invalid `text`.
 *   4. Tenant isolation on POST: the row is owned by the authenticated
 *      user, never a forged `user_id` from the client.
 *   5. 401 when unauthenticated (GET).
 *   6. GET returns the calling user's inspirations, newest first.
 *   7. Tenant isolation on GET: a second user never sees the first user's
 *      rows even though both rows exist in the same database.
 *   8. DELETE: 401 unauthenticated, 400 invalid uuid, 404 cross-tenant,
 *      200 happy path; row + reflections cascade-removed; idempotent 404
 *      on re-delete.
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { inspirations, reflections, users } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { app } from "../index.js";

async function signupTestUser(label: string) {
  const email = `inspirations-smoke-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const password = "supersecret123";
  const signup = await app.request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: `Insp Smoke ${label}` }),
  });
  if (signup.status !== 201) {
    throw new Error(`Signup failed: ${signup.status} ${await signup.text()}`);
  }
  return (await signup.json()) as {
    user: { id: string; email: string; name: string };
    token: string;
  };
}

async function main() {
  // Two independent users so we can exercise tenant isolation on the GET
  // path: A inserts a row, B lists, B must NOT see A's row.
  const { user, token } = await signupTestUser("a");
  const { user: userB, token: tokenB } = await signupTestUser("b");

  try {
    // 1. Unauthenticated request → 401.
    const noAuth = await app.request("/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "anonymous" }),
    });
    if (noAuth.status !== 401) {
      throw new Error(`Expected 401 without auth, got ${noAuth.status}`);
    }
    console.log("[1/7] unauthenticated POST → 401 ✅");

    // 2. Happy path → 201 with row, cluster NULL.
    const ok = await app.request("/inspirations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: "  light bends around dense thoughts  ",
        kind: "note",
        category: 3,
      }),
    });
    if (ok.status !== 201) {
      throw new Error(`Expected 201, got ${ok.status}: ${await ok.text()}`);
    }
    const okBody = (await ok.json()) as {
      inspiration: {
        id: string;
        userId: string;
        text: string;
        kind: string | null;
        category: number | null;
        cluster: string | null;
        classifiedAt: string | null;
      };
    };
    const insp = okBody.inspiration;
    if (insp.userId !== user.id) {
      throw new Error(
        `Tenant leak: inspiration.userId=${insp.userId} but signed in as ${user.id}`,
      );
    }
    if (insp.text !== "light bends around dense thoughts") {
      throw new Error(`Text not trimmed/preserved: ${JSON.stringify(insp.text)}`);
    }
    if (insp.kind !== "note") throw new Error(`kind mismatch: ${insp.kind}`);
    if (insp.category !== 3) throw new Error(`category mismatch: ${insp.category}`);
    if (insp.cluster !== null) {
      throw new Error(`cluster should be null on insert, got ${insp.cluster}`);
    }
    if (insp.classifiedAt !== null) {
      throw new Error(
        `classifiedAt should be null on insert, got ${insp.classifiedAt}`,
      );
    }
    console.log("[2/7] happy path 201 + nulls ✅");

    // 3. Missing text → 400.
    const noText = await app.request("/inspirations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ kind: "note" }),
    });
    if (noText.status !== 400) {
      throw new Error(`Expected 400 on missing text, got ${noText.status}`);
    }
    console.log("[3/7] missing text → 400 ✅");

    // 4. Forged user_id is silently ignored — server uses the auth context.
    const forged = await app.request("/inspirations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: "should still belong to me",
        userId: "00000000-0000-0000-0000-000000000000",
        user_id: "00000000-0000-0000-0000-000000000000",
      }),
    });
    if (forged.status !== 201) {
      throw new Error(
        `Expected 201 for body w/ forged userId, got ${forged.status}`,
      );
    }
    const forgedBody = (await forged.json()) as {
      inspiration: { id: string; userId: string };
    };
    if (forgedBody.inspiration.userId !== user.id) {
      throw new Error(
        `Tenant leak: forged userId persisted (${forgedBody.inspiration.userId})`,
      );
    }
    console.log("[4/7] forged user_id ignored ✅");

    // 5. Unauthenticated GET → 401.
    const noAuthGet = await app.request("/inspirations", { method: "GET" });
    if (noAuthGet.status !== 401) {
      throw new Error(`Expected 401 on GET without auth, got ${noAuthGet.status}`);
    }
    console.log("[5/7] unauthenticated GET → 401 ✅");

    // 6. Authenticated GET as user A returns A's rows, newest first.
    //    Insert a second row so we can verify ordering.
    await app.request("/inspirations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text: "a-second-save" }),
    });
    const listA = await app.request("/inspirations", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (listA.status !== 200) {
      throw new Error(`Expected 200 on GET, got ${listA.status}: ${await listA.text()}`);
    }
    const listABody = (await listA.json()) as {
      inspirations: Array<{
        id: string;
        userId: string;
        text: string;
        cluster: string | null;
        createdAt: string;
      }>;
    };
    if (!Array.isArray(listABody.inspirations)) {
      throw new Error(`Expected { inspirations: [] }, got ${JSON.stringify(listABody)}`);
    }
    if (listABody.inspirations.length < 3) {
      // 3 rows so far: happy path + forged + a-second-save.
      throw new Error(
        `Expected at least 3 rows for user A, got ${listABody.inspirations.length}`,
      );
    }
    for (const row of listABody.inspirations) {
      if (row.userId !== user.id) {
        throw new Error(
          `Tenant leak in GET: row.userId=${row.userId} but signed in as ${user.id}`,
        );
      }
    }
    // Newest first: created_at strictly non-increasing.
    for (let i = 1; i < listABody.inspirations.length; i += 1) {
      const prev = new Date(listABody.inspirations[i - 1]!.createdAt).getTime();
      const cur = new Date(listABody.inspirations[i]!.createdAt).getTime();
      if (prev < cur) {
        throw new Error(
          `GET /inspirations is not newest-first: ${prev} < ${cur} at index ${i}`,
        );
      }
    }
    console.log("[6/7] GET returns caller's rows newest-first ✅");

    // 7. Tenant isolation on GET: user B sees zero of user A's rows.
    const listB = await app.request("/inspirations", {
      method: "GET",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    if (listB.status !== 200) {
      throw new Error(`Expected 200 for user B, got ${listB.status}`);
    }
    const listBBody = (await listB.json()) as {
      inspirations: Array<{ id: string; userId: string }>;
    };
    if (listBBody.inspirations.length !== 0) {
      throw new Error(
        `Tenant leak: user B saw ${listBBody.inspirations.length} rows (expected 0).`,
      );
    }
    for (const row of listBBody.inspirations) {
      if (row.userId === user.id) {
        throw new Error(
          `Tenant leak: user B's GET surfaced a row owned by user A (${row.id}).`,
        );
      }
    }
    console.log("[7/7] GET tenant isolation across users ✅");

    // 8. DELETE coverage.
    //    8a. Unauthenticated DELETE → 401.
    const deleteNoAuth = await app.request(
      `/inspirations/${listABody.inspirations[0]!.id}`,
      { method: "DELETE" },
    );
    if (deleteNoAuth.status !== 401) {
      throw new Error(
        `Expected 401 on DELETE without auth, got ${deleteNoAuth.status}`,
      );
    }

    //    8b. Invalid uuid → 400.
    const deleteBadId = await app.request("/inspirations/not-a-uuid", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (deleteBadId.status !== 400) {
      throw new Error(
        `Expected 400 on DELETE with malformed id, got ${deleteBadId.status}`,
      );
    }

    //    8c. Cross-tenant DELETE → 404 (don't leak existence).
    const targetId = listABody.inspirations[0]!.id;
    const deleteCrossTenant = await app.request(
      `/inspirations/${targetId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenB}` },
      },
    );
    if (deleteCrossTenant.status !== 404) {
      throw new Error(
        `Expected 404 on cross-tenant DELETE, got ${deleteCrossTenant.status}`,
      );
    }
    // The row must still exist for user A.
    const stillThere = await app.request("/inspirations", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const stillThereBody = (await stillThere.json()) as {
      inspirations: Array<{ id: string }>;
    };
    if (!stillThereBody.inspirations.some((r) => r.id === targetId)) {
      throw new Error(
        "Cross-tenant DELETE leaked: target row was removed for the owner",
      );
    }

    //    8d. Add a reflection so we can verify cascade behaviour.
    const reflectionInsert = await app.request(
      `/inspirations/${targetId}/reflections`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: "what survives this delete?" }),
      },
    );
    if (reflectionInsert.status !== 201) {
      throw new Error(
        `Reflection setup failed: ${reflectionInsert.status} ${await reflectionInsert.text()}`,
      );
    }
    const reflectionId = (
      (await reflectionInsert.json()) as { reflection: { id: string } }
    ).reflection.id;

    //    8e. Happy-path DELETE → 200, returns { id }.
    const deleteOk = await app.request(`/inspirations/${targetId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (deleteOk.status !== 200) {
      throw new Error(
        `Expected 200 on DELETE, got ${deleteOk.status}: ${await deleteOk.text()}`,
      );
    }
    const deletedBody = (await deleteOk.json()) as { id: string };
    if (deletedBody.id !== targetId) {
      throw new Error(
        `Delete confirmation id mismatch: ${deletedBody.id} vs ${targetId}`,
      );
    }

    //    8f. Row is gone from GET /inspirations.
    const afterDelete = await app.request("/inspirations", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterDeleteBody = (await afterDelete.json()) as {
      inspirations: Array<{ id: string }>;
    };
    if (afterDeleteBody.inspirations.some((r) => r.id === targetId)) {
      throw new Error(
        "DELETE did not remove the row from GET /inspirations",
      );
    }

    //    8g. Cascade: reflection row is gone too. Hit the DB directly so a
    //        bug in the reflections endpoint cannot mask a stale row.
    const db = getDb();
    const cascaded = await db
      .select({ id: reflections.id })
      .from(reflections)
      .where(eq(reflections.id, reflectionId));
    if (cascaded.length !== 0) {
      throw new Error(
        `Cascade failed: reflection ${reflectionId} survived inspiration delete`,
      );
    }

    //    8h. Re-delete is 404 (no-op for the caller).
    const deleteAgain = await app.request(`/inspirations/${targetId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (deleteAgain.status !== 404) {
      throw new Error(
        `Expected 404 on re-DELETE, got ${deleteAgain.status}`,
      );
    }
    console.log("[8/8] DELETE auth + tenant + cascade + idempotency ✅");
  } finally {
    // Cleanup: cascade through inspirations → users so we don't leave
    // residue in Neon. inspirations.user_id has ON DELETE CASCADE so the
    // single DELETE on users is sufficient, but we also clean by id in
    // case the cascade ever changes.
    const db = getDb();
    await db.delete(inspirations).where(eq(inspirations.userId, user.id));
    await db.delete(inspirations).where(eq(inspirations.userId, userB.id));
    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(users).where(eq(users.id, userB.id));
    console.log("cleaned up test users + inspirations");
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
