import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { inArray } from "drizzle-orm";

import {
  attachments,
  inspirationEmbeddings,
  inspirationRevisitEvents,
  inspirations,
  reflections,
  type Inspiration,
} from "../src/db/index.js";
import {
  calculateContextScore,
  calculateDisplayedInspirationScore,
  calculateInspirationScoreBreakdown,
  calculateLocalInspirationScoreSnapshot,
  persistLocalInspirationScores,
} from "../src/lib/inspiration-scores.js";

import { createUserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

const NOW = new Date("2026-05-12T00:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

async function createEmbedding(
  testDb: TestDatabase,
  inspiration: Inspiration,
  embedding: number[],
): Promise<void> {
  await testDb.db.insert(inspirationEmbeddings).values({
    userId: inspiration.userId,
    inspirationId: inspiration.id,
    model: "test-embedding-model",
    dimensions: embedding.length,
    inputHash: `hash-${inspiration.id}`,
    embedding,
  });
}

async function createScoreTestInspiration(
  testDb: TestDatabase,
  userId: string,
  values: Pick<Inspiration, "text" | "createdAt">,
): Promise<Inspiration> {
  const [row] = await testDb.db
    .insert(inspirations)
    .values({
      userId,
      text: values.text,
      kind: "note",
      category: 0,
      createdAt: values.createdAt,
    } as typeof inspirations.$inferInsert)
    .returning();

  if (!row) {
    throw new Error("createScoreTestInspiration: insert returned no row");
  }

  return row;
}

type PersistDb = Parameters<typeof persistLocalInspirationScores>[0];

async function readScores(testDb: TestDatabase, ids: string[]) {
  const rows = await testDb.db
    .select({ id: inspirations.id, importanceScore: inspirations.importanceScore, wowScore: inspirations.wowScore })
    .from(inspirations)
    .where(inArray(inspirations.id, ids));

  return new Map(rows.map((row) => [row.id, row]));
}

describe("local inspiration score snapshots", () => {
  it("uses maturity/time-gap direction instead of recency", () => {
    const base = {
      text: "",
      kind: null,
      category: null,
      hasReflection: false,
      now: NOW,
    };

    expect(
      calculateLocalInspirationScoreSnapshot({
        ...base,
        createdAt: daysAgo(0),
      }),
    ).toEqual({ importanceScore: 0, wowScore: 0 });

    expect(
      calculateLocalInspirationScoreSnapshot({
        ...base,
        createdAt: daysAgo(30),
      }),
    ).toEqual({ importanceScore: 6, wowScore: 3 });

    expect(
      calculateLocalInspirationScoreSnapshot({
        ...base,
        createdAt: daysAgo(180),
      }),
    ).toEqual({ importanceScore: 10, wowScore: 6 });
  });

  it("calculates the freshness-adjusted displayed score from persisted core WOW", () => {
    expect(
      calculateDisplayedInspirationScore({
        coreWowScore: 60,
        createdAt: daysAgo(0),
        now: NOW,
      }),
    ).toBe(64);

    expect(
      calculateDisplayedInspirationScore({
        coreWowScore: 60,
        createdAt: daysAgo(30),
        now: NOW,
      }),
    ).toBe(59);
  });

  it("does not use coarse kind/category metadata as context score", () => {
    const sparse = calculateLocalInspirationScoreSnapshot({
      text: "same saved thought",
      kind: null,
      category: null,
      createdAt: daysAgo(30),
      hasReflection: false,
      now: NOW,
    });

    const categorized = calculateLocalInspirationScoreSnapshot({
      text: "same saved thought",
      kind: "quote",
      category: 7,
      createdAt: daysAgo(30),
      hasReflection: false,
      now: NOW,
    });

    expect(categorized).toEqual(sparse);
  });

  it("calculates bounded context from meaningful links, attachments, and reflection text", () => {
    expect(calculateContextScore()).toBe(0);
    expect(calculateContextScore({ meaningfulLinkCount: 1 })).toBeGreaterThan(0);
    expect(calculateContextScore({ nonLinkAttachmentCount: 1 })).toBeGreaterThan(0);
    expect(calculateContextScore({ reflectionTextChars: 160 })).toBeGreaterThan(0);

    expect(
      calculateContextScore({
        meaningfulLinkCount: 99,
        nonLinkAttachmentCount: 99,
        reflectionTextChars: 99_999,
      }),
    ).toBe(1);
  });

  it("lets context increase local content depth while bare/minimal content stays bounded", () => {
    const bare = calculateLocalInspirationScoreSnapshot({
      text: "https://example.com",
      kind: null,
      category: null,
      createdAt: daysAgo(0),
      hasReflection: false,
      now: NOW,
    });

    const contextual = calculateLocalInspirationScoreSnapshot({
      text: "https://example.com",
      kind: null,
      category: null,
      createdAt: daysAgo(0),
      hasReflection: false,
      contextSignals: {
        meaningfulLinkCount: 1,
        nonLinkAttachmentCount: 1,
        reflectionTextChars: 320,
      },
      now: NOW,
    });

    expect(contextual.importanceScore).toBeGreaterThan(bare.importanceScore);
    expect(contextual.wowScore).toBeGreaterThan(bare.wowScore);
    expect(bare.importanceScore).toBeLessThan(10);
  });
});

describe("persistLocalInspirationScores relationship signals", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    vi.setSystemTime(NOW);
    await testDb.truncateAll();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await testDb.cleanup();
  });

  it("uses stored embeddings to persist trigger and bounded related prior core WOW scores", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "Trigger: origami shelters for public plazas.",
      createdAt: new Date("2026-05-12T00:00:00.000Z"),
    });
    const relatedPrior = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "Prior: folding paper structures for shade.",
      createdAt: new Date("2026-03-28T00:00:00.000Z"),
    });
    const surprisingPrior = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "Prior: pop-up libraries as civic furniture.",
      createdAt: new Date("2026-02-11T00:00:00.000Z"),
    });

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, relatedPrior, [0.8, 0.6]);
    await createEmbedding(testDb, surprisingPrior, [0.62, Math.sqrt(1 - 0.62 ** 2)]);

    const snapshot = await persistLocalInspirationScores(testDb.db as PersistDb, trigger);
    const scores = await readScores(testDb, [trigger.id, relatedPrior.id, surprisingPrior.id]);

    expect(snapshot.wowScore).toBeGreaterThan(snapshot.importanceScore);
    expect(scores.get(trigger.id)?.wowScore).toBe(snapshot.wowScore);
    expect(scores.get(relatedPrior.id)?.wowScore).toBeGreaterThan(0);
    expect(scores.get(surprisingPrior.id)?.wowScore).toBeGreaterThan(0);
  });

  it("keeps relationship signals at zero when the trigger has no stored embedding", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "Trigger without an embedding.",
      createdAt: NOW,
    });

    const snapshot = await persistLocalInspirationScores(testDb.db as PersistDb, trigger);
    const baseline = calculateLocalInspirationScoreSnapshot({
      text: trigger.text,
      kind: trigger.kind,
      category: trigger.category,
      createdAt: trigger.createdAt,
      hasReflection: false,
    });

    expect(snapshot).toEqual(baseline);
  });

  it("exposes raw revisit counts separately from normalized revisit score signals", async () => {
    const alice = await createUserFixture(testDb.db);
    const inspiration = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "Newly opened inspiration should show one raw revisit day.",
      createdAt: NOW,
    });

    await testDb.db.insert(inspirationRevisitEvents).values({
      inspirationId: inspiration.id,
      userId: alice.user.id,
      eventType: "detail_opened",
      createdAt: NOW,
    } as typeof inspirationRevisitEvents.$inferInsert);

    const breakdown = await calculateInspirationScoreBreakdown(testDb.db as PersistDb, {
      userId: alice.user.id,
      inspirationId: inspiration.id,
      now: NOW,
    });

    expect(breakdown?.factors.revisit).toMatchObject({
      uniqueRevisitDays: 1,
      totalRevisitCount: 1,
      recentRevisitCount: 1,
      uniqueRevisitDaysScore: 33,
      totalRevisitCountScore: 23,
      revisitedInLast7DaysScore: 100,
    });
  });

  it("returns selected-inspiration breakdown with stored, read-time, and unavailable relationship fields", async () => {
    const alice = await createUserFixture(testDb.db);
    const target = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "A detailed note about civic furniture and folding shade structures.",
      createdAt: daysAgo(30),
    });

    await testDb.db.insert(reflections).values({
      inspirationId: target.id,
      userId: alice.user.id,
      question: "Why save this?",
      answer: "It connects a physical design pattern to public spaces.",
    });

    const snapshot = await persistLocalInspirationScores(testDb.db as PersistDb, target);
    const breakdown = await calculateInspirationScoreBreakdown(testDb.db as PersistDb, {
      userId: alice.user.id,
      inspirationId: target.id,
      now: NOW,
    });

    expect(breakdown).not.toBeNull();
    expect(breakdown!.inspirationId).toBe(target.id);
    expect(breakdown!.persistedCoreWowScore).toBe(snapshot.wowScore);
    expect(breakdown!.stored.coreWowScore).toBe(snapshot.wowScore);
    expect(breakdown!.importanceScore).toBe(snapshot.importanceScore);
    expect(breakdown!.stored.importanceScore).toBe(snapshot.importanceScore);
    expect(breakdown!.displayedWowScore).toBe(
      calculateDisplayedInspirationScore({
        coreWowScore: snapshot.wowScore,
        createdAt: target.createdAt,
        now: NOW,
      }),
    );
    expect(breakdown!.freshnessAdjustment.source).toBe("read_time");
    expect(breakdown!.factors.content.reflectionTextChars).toBeGreaterThan(0);
    expect(breakdown!.factors.processing.hasReflection).toBe(true);
    expect(breakdown!.factors.relationship.available).toBe(false);
    expect(breakdown!.factors.relationship.score).toBeNull();
    expect(breakdown!.factors.relationship.note).toContain("viewing does not generate embeddings");
    expect(breakdown!.formulas.displayedWow).toContain("FreshnessDecay");
  });

  it("persists higher bounded scores from tenant-scoped context signals", async () => {
    const alice = await createUserFixture(testDb.db);
    const bob = await createUserFixture(testDb.db, { email: "bob-context@example.com" });
    const bare = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "https://example.com",
      createdAt: NOW,
    });
    const contextual = await createScoreTestInspiration(testDb, alice.user.id, {
      text: "https://example.com",
      createdAt: NOW,
    });
    const bobInspiration = await createScoreTestInspiration(testDb, bob.user.id, {
      text: "https://example.com",
      createdAt: NOW,
    });

    await testDb.db.insert(attachments).values([
      {
        inspirationId: bare.id,
        type: "link",
        url: "https://example.com",
        name: null,
      },
      {
        inspirationId: contextual.id,
        type: "link",
        url: "https://example.com",
        name: "Research notes about urban shade",
      },
      {
        inspirationId: contextual.id,
        type: "image",
        url: "https://bucket.s3.us-west-2.amazonaws.com/context.png",
        name: "context.png",
        s3Key: `users/${alice.user.id}/attachments/context.png`,
        contentType: "image/png",
        size: 2048,
      },
    ] as (typeof attachments.$inferInsert)[]);
    await testDb.db.insert(reflections).values([
      {
        inspirationId: contextual.id,
        userId: alice.user.id,
        question: "Why does this matter?",
        answer:
          "It connects the pasted source to our own civic furniture idea and captures enough context to revisit it later.",
      },
      {
        inspirationId: contextual.id,
        userId: bob.user.id,
        question: "Cross-tenant noise",
        answer: "This row is malformed on purpose and must not count for Alice.",
      },
      {
        inspirationId: bobInspiration.id,
        userId: bob.user.id,
        question: "Bob context",
        answer: "Bob's rich context must not affect Alice's inspiration scoring.",
      },
    ]);

    const bareSnapshot = await persistLocalInspirationScores(testDb.db as PersistDb, bare);
    const contextualSnapshot = await persistLocalInspirationScores(
      testDb.db as PersistDb,
      contextual,
    );

    expect(contextualSnapshot.importanceScore).toBeGreaterThan(
      bareSnapshot.importanceScore,
    );
    expect(contextualSnapshot.wowScore).toBeGreaterThan(bareSnapshot.wowScore);
    expect(bareSnapshot.importanceScore).toBeLessThanOrEqual(10);
  });
});
