/**
 * WOW moments route smoke tests.
 *
 * These tests focus on the tenant-bound read surface introduced by the WOW
 * moments foundation slice. In particular, a malformed join row must not let a
 * caller see another user's inspiration text through /wow-moments.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  inspirationEmbeddings,
  inspirations,
  wowMomentInspirations,
  wowMoments,
} from "../src/db/index.js";
import { getDb } from "../src/lib/db.js";
import { GEMINI_EMBEDDING_DIMENSIONS } from "../src/lib/inspiration-embeddings.js";
import { createWowMomentsRoutes } from "../src/routes/wow-moments.js";
import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { apiRequest, authedClient, createCleanupTracker } from "./helpers/index.js";

const cleanup = createCleanupTracker();

afterEach(async () => {
  vi.restoreAllMocks();
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

function embeddingVector(seed = 1): number[] {
  return Array.from({ length: GEMINI_EMBEDDING_DIMENSIONS }, (_, index) =>
    index === 0 ? seed : index / GEMINI_EMBEDDING_DIMENSIONS,
  );
}

async function insertEmbedding(userId: string, inspirationId: string, seed = 1) {
  const [row] = await getDb()
    .insert(inspirationEmbeddings)
    .values({
      userId,
      inspirationId,
      model: "text-embedding-004",
      dimensions: GEMINI_EMBEDDING_DIMENSIONS,
      inputHash: `test-hash-${inspirationId}`,
      embedding: embeddingVector(seed),
    } as typeof inspirationEmbeddings.$inferInsert)
    .returning();
  expect(row).toBeTruthy();
  return row!;
}

function mockGeminiFetch(judgment: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const href = String(url);
    if (href.includes(":embedContent")) {
      return new Response(
        JSON.stringify({ embedding: { values: embeddingVector(0.75) } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (href.includes(":generateContent")) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(judgment) }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "unexpected test URL" }), { status: 500 });
  });
}

describe("POST /wow-moments/generate — manual generation", () => {
  it("requires authentication", async () => {
    const res = await apiRequest("/wow-moments/generate", {
      method: "POST",
      body: { inspirationId: "00000000-0000-4000-8000-000000000001" },
    });

    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON and invalid payloads before calling Gemini", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const malformed = await authedClient(alice).request("/wow-moments/generate", {
      method: "POST",
      body: "not-json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Request body must be valid JSON" });

    const invalid = await authedClient(alice).json("POST", "/wow-moments/generate", {
      inspirationId: "not-a-uuid",
      limit: 51,
      extra: true,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: "Invalid WOW generation payload" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown and cross-tenant inspiration ids without revealing existence", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    const bob = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);
    const bobInspiration = await createInspirationFixture(db, bob.user.id, {
      text: "Bob private idea",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const unknown = await authedClient(alice).json("POST", "/wow-moments/generate", {
      inspirationId: "00000000-0000-4000-8000-000000000001",
    });
    const crossTenant = await authedClient(alice).json("POST", "/wow-moments/generate", {
      inspirationId: bobInspiration.id,
    });

    expect(unknown.status).toBe(404);
    expect(crossTenant.status).toBe(404);
    expect(unknown.body).toEqual(crossTenant.body);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a structured no-op when the bounded judge says it is not a WOW moment", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);
    const trigger = await createInspirationFixture(db, alice.user.id, { text: "Trigger note" });
    const candidate = await createInspirationFixture(db, alice.user.id, { text: "Related note" });
    await insertEmbedding(alice.user.id, candidate.id, 0.5);
    mockGeminiFetch({ isWowMoment: false });

    const res = await authedClient(alice).json("POST", "/wow-moments/generate", {
      inspirationId: trigger.id,
      limit: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      generated: false,
      reason: "not_wow_moment",
      judgment: { isWowMoment: false },
      embeddingStatus: "created",
    });
    const moments = await db
      .select()
      .from(wowMoments)
      .where(eq(wowMoments.userId, alice.user.id));
    expect(moments).toHaveLength(0);
  });

  it("persists accepted WOW moments idempotently and returns the existing row on retry", async () => {
    const db = getDb();
    const alice = await createUserFixture(db);
    cleanup.trackUser(alice.user.id);
    const trigger = await createInspirationFixture(db, alice.user.id, { text: "Trigger bridge" });
    const candidate = await createInspirationFixture(db, alice.user.id, { text: "Candidate bridge" });
    await insertEmbedding(alice.user.id, candidate.id, 0.25);
    const fetchMock = mockGeminiFetch({
      isWowMoment: true,
      kind: "bridge",
      title: "A bridge appears",
      why: "The trigger and candidate connect two useful frames.",
      reflectionQuestion: "What would you try next?",
      relatedInspirationIds: [candidate.id],
    });

    const first = await authedClient(alice).json<any>("POST", "/wow-moments/generate", {
      inspirationId: trigger.id,
      limit: 5,
    });
    const second = await authedClient(alice).json<any>("POST", "/wow-moments/generate", {
      inspirationId: trigger.id,
      limit: 5,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toMatchObject({ generated: true, status: "created" });
    expect(second.body).toMatchObject({ generated: true, status: "existing" });
    expect(second.body.wowMoment.id).toBe(first.body.wowMoment.id);
    expect(second.body.inspirationLinks.map((link: { inspirationId: string }) => link.inspirationId)).toEqual([
      trigger.id,
      candidate.id,
    ]);
    const userMoments = await db
      .select()
      .from(wowMoments)
      .where(eq(wowMoments.userId, alice.user.id));
    expect(userMoments).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(":embedContent"))).toHaveLength(1);
  });

  it("returns stable provider-unavailable JSON when Gemini fails", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    const previousSstKey = process.env.SST_RESOURCE_GeminiApiKey;
    delete process.env.GEMINI_API_KEY;
    delete process.env.SST_RESOURCE_GeminiApiKey;
    try {
      const db = getDb();
      const alice = await createUserFixture(db);
      cleanup.trackUser(alice.user.id);
      const trigger = await createInspirationFixture(db, alice.user.id, { text: "Needs embedding" });

      const res = await authedClient(alice).json("POST", "/wow-moments/generate", {
        inspirationId: trigger.id,
      });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: "WOW generation unavailable",
        code: "wow_generation_unavailable",
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousKey;
      }
      if (previousSstKey === undefined) {
        delete process.env.SST_RESOURCE_GeminiApiKey;
      } else {
        process.env.SST_RESOURCE_GeminiApiKey = previousSstKey;
      }
    }
  });

  it("maps stale embedding source results to a retryable 409 without judging or persisting", async () => {
    const app = new Hono();
    const fakeDb = getDb();
    app.route(
      "/wow-moments",
      createWowMomentsRoutes({
        getDatabase: () => fakeDb,
        authMiddleware: async (c, next) => {
          c.set("user", {
            id: "00000000-0000-4000-8000-000000000002",
            email: "test@example.com",
            name: "Test User",
            avatarUrl: null,
          });
          c.set("sessionToken", "test-token");
          await next();
        },
        ensureEmbedding: async () => ({
          status: "stale_source",
          embedding: null,
          generated: true,
          inputHash: "stale-hash",
        }),
        judgeWowMoment: async () => {
          throw new Error("judge should not run after stale embedding");
        },
      }),
    );

    const res = await app.request("/wow-moments/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspirationId: "00000000-0000-4000-8000-000000000001" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Inspiration changed while generating embedding",
      code: "stale_source",
      retryable: true,
    });
  });
});
