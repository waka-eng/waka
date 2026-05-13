/**
 * WOW moments route smoke tests.
 *
 * These tests focus on the tenant-bound read surface introduced by the WOW
 * moments foundation slice. In particular, a malformed join row must not let a
 * caller see another user's inspiration text through /wow-moments.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  inspirations,
  wowMomentInspirations,
  wowMoments,
} from "../src/db/index.js";
import { getDb } from "../src/lib/db.js";
import { createUserFixture } from "./fixtures/users.js";
import { apiRequest, authedClient, createCleanupTracker } from "./helpers/index.js";

const cleanup = createCleanupTracker();

afterEach(async () => {
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
});

beforeAll(() => {
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  expect(
    process.env.JWT_SECRET ?? process.env.AUTH_SECRET,
    "JWT_SECRET or AUTH_SECRET",
  ).toBeTruthy();
});

interface ApiWowMoment {
  id: string;
  userId: string;
  title: string;
  kind: "recurrence" | "bridge" | "surprise_bridge" | "tension" | "outlier";
  why: string;
  reflectionQuestion: string | null;
  wowScore: number;
  createdAt: string;
  updatedAt: string;
  relatedInspirations: Array<{
    inspirationId: string;
    role: string;
    reason: string;
    text: string;
    kind: string | null;
    createdAt: string;
  }>;
}

interface ListWowMomentsResponse {
  wowMoments: ApiWowMoment[];
}

async function insertWowMomentForUser(
  userId: string,
  input: {
    title: string;
    createdAt: Date;
    wowScore?: number;
    idempotencyKey: string;
  },
): Promise<{ id: string }> {
  const [moment] = await getDb()
    .insert(wowMoments)
    .values({
      userId,
      title: input.title,
      kind: "bridge",
      why: `${input.title} why`,
      reflectionQuestion: null,
      wowScore: input.wowScore ?? 50,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      idempotencyKey: input.idempotencyKey,
    } as typeof wowMoments.$inferInsert)
    .returning({ id: wowMoments.id });

  expect(moment).toBeTruthy();
  return moment!;
}

describe("GET /wow-moments — list contract", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/wow-moments");

    expect(res.status).toBe(401);
  });

  it("returns an empty list for an authenticated user with no WOW moments", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);

    const res = await authedClient(alice).get<ListWowMomentsResponse>(
      "/wow-moments",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wowMoments: [] });
  });

  it("orders newest WOW moments first and caps the response at 20", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);

    for (let index = 0; index < 23; index += 1) {
      await insertWowMomentForUser(alice.user.id, {
        title: `WOW ${index.toString().padStart(2, "0")}`,
        createdAt: new Date(Date.UTC(2026, 4, 1, 12, index, 0)),
        wowScore: index,
        idempotencyKey: `test:wow-moments:limit:${alice.user.id}:${index}`,
      });
    }

    const res = await authedClient(alice).get<ListWowMomentsResponse>(
      "/wow-moments",
    );

    expect(res.status).toBe(200);
    expect(res.body.wowMoments).toHaveLength(20);
    expect(res.body.wowMoments.map((moment) => moment.title)).toEqual(
      Array.from({ length: 20 }, (_, offset) =>
        `WOW ${(22 - offset).toString().padStart(2, "0")}`,
      ),
    );
  });
});

describe("GET /wow-moments — ownership", () => {
  it("does not leak cross-tenant related inspiration text through malformed join rows", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    const bob = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const [aliceInspiration] = await db
      .insert(inspirations)
      .values({
        userId: alice.user.id,
        text: "Alice-owned constellation note",
        kind: "note",
      } as typeof inspirations.$inferInsert)
      .returning({ id: inspirations.id });
    const [bobInspiration] = await db
      .insert(inspirations)
      .values({
        userId: bob.user.id,
        text: "Bob private inspiration must not leak",
        kind: "note",
      } as typeof inspirations.$inferInsert)
      .returning({ id: inspirations.id });
    expect(aliceInspiration).toBeTruthy();
    expect(bobInspiration).toBeTruthy();

    const [moment] = await db
      .insert(wowMoments)
      .values({
        userId: alice.user.id,
        title: "Pattern only Alice can see",
        kind: "bridge",
        why: "Connects Alice-owned signals only.",
        reflectionQuestion: "What does Alice want to do next?",
        wowScore: 88,
        idempotencyKey: `test:wow-moments:ownership:${alice.user.id}`,
      } as typeof wowMoments.$inferInsert)
      .returning({ id: wowMoments.id });
    expect(moment).toBeTruthy();

    await db.insert(wowMomentInspirations).values({
      userId: alice.user.id,
      wowMomentId: moment!.id,
      inspirationId: aliceInspiration!.id,
      role: "primary",
      reason: "Same tenant row should be visible.",
      sortOrder: 0,
    } as typeof wowMomentInspirations.$inferInsert);

    await expect(
      db.insert(wowMomentInspirations).values({
        userId: alice.user.id,
        wowMomentId: moment!.id,
        inspirationId: bobInspiration!.id,
        role: "malformed-cross-tenant",
        reason: "Composite tenant FK must reject this row.",
        sortOrder: 1,
      } as typeof wowMomentInspirations.$inferInsert),
    ).rejects.toThrow();

    const res = await authedClient(alice).get<ListWowMomentsResponse>(
      "/wow-moments",
    );

    expect(res.status).toBe(200);
    const returnedMoment = res.body.wowMoments.find((row) => row.id === moment!.id);
    expect(returnedMoment).toBeTruthy();
    expect(returnedMoment!.userId).toBe(alice.user.id);
    expect(returnedMoment!.relatedInspirations).toHaveLength(1);
    expect(returnedMoment!.relatedInspirations[0]!.inspirationId).toBe(
      aliceInspiration!.id,
    );
    expect(returnedMoment!.relatedInspirations[0]!.text).toBe(
      "Alice-owned constellation note",
    );
    expect(
      returnedMoment!.relatedInspirations.some(
        (related) => related.text === "Bob private inspiration must not leak",
      ),
    ).toBe(false);
  });
});
