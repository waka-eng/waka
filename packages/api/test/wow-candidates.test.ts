import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { inspirationEmbeddings, inspirations, type Inspiration } from "../src/db/index.js";
import { findWowMomentCandidates, MAX_DB_CANDIDATE_POOL } from "../src/lib/wow-candidates.js";

import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

async function createEmbedding(
  testDb: TestDatabase,
  inspiration: Inspiration,
  embedding: number[],
  options: { model?: string; dimensions?: number } = {},
): Promise<void> {
  await testDb.db.insert(inspirationEmbeddings).values({
    userId: inspiration.userId,
    inspirationId: inspiration.id,
    model: options.model ?? "test-embedding-model",
    dimensions: options.dimensions ?? embedding.length,
    inputHash: `hash-${inspiration.id}`,
    embedding,
  });
}

async function setWowScore(
  testDb: TestDatabase,
  inspiration: Inspiration,
  wowScore: number,
): Promise<void> {
  await testDb.sql`
    UPDATE inspirations
    SET wow_score = ${wowScore}
    WHERE id = ${inspiration.id}
  `;
}

describe("findWowMomentCandidates", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("filters to same-user embedded candidates and excludes the trigger inspiration", async () => {
    const alice = await createUserFixture(testDb.db);
    const bob = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: modular synthesizer patches as garden paths.",
    });
    const aliceCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Alice candidate: audio patch cables form navigable paths.",
    });
    const bobCandidate = await createInspirationFixture(testDb.db, bob.user.id, {
      text: "Bob candidate: similar text but wrong tenant.",
    });

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, aliceCandidate, [0.95, 0.05]);
    await createEmbedding(testDb, bobCandidate, [1, 0]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 10,
    });

    expect(result.trigger?.id).toBe(trigger.id);
    expect(result.candidates.map((candidate) => candidate.inspiration.id)).toEqual([
      aliceCandidate.id,
    ]);
    expect(result.candidates[0]!.inspiration.text).toContain("Alice candidate");
  });

  it("excludes candidates with incompatible embedding model or dimensions", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: projection mapping for stage sets.",
    });
    const compatibleCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Compatible candidate: stage lighting sketches.",
    });
    const wrongModelCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Wrong model candidate with high persisted score.",
    });
    const wrongDimensionsCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Wrong dimensions candidate with high persisted score.",
    });

    await setWowScore(testDb, wrongModelCandidate, 100);
    await setWowScore(testDb, wrongDimensionsCandidate, 100);

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, compatibleCandidate, [0, 1]);
    await createEmbedding(testDb, wrongModelCandidate, [1, 0], { model: "other-model" });
    await createEmbedding(testDb, wrongDimensionsCandidate, [1, 0, 0]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 10,
    });

    expect(result.candidates.map((candidate) => candidate.inspiration.id)).toEqual([
      compatibleCandidate.id,
    ]);
  });

  it("returns no candidates when the trigger has no embedding", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger without embedding.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Embedded candidate should not be considered without trigger embedding.",
    });

    await createEmbedding(testDb, candidate, [1, 0]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 10,
    });

    expect(result).toEqual({ trigger: null, candidates: [] });
  });

  it("returns the trigger without candidates when limit is zero", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger with zero requested candidates.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate should be skipped by limit zero.",
    });

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 0,
    });

    expect(result.trigger?.id).toBe(trigger.id);
    expect(result.candidates).toEqual([]);
  });

  it("ranks high direct similarity well with score breakdown metadata", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: fast prototyping with clay models.",
    });
    const highSimilarity = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "High similarity: clay prototyping for physical interfaces.",
    });
    const lowSimilarity = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Low similarity: moon phases and grocery receipts.",
    });

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, highSimilarity, [1, 0]);
    await createEmbedding(testDb, lowSimilarity, [0, 1]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 2,
    });

    expect(result.candidates[0]!.inspiration.id).toBe(highSimilarity.id);
    expect(result.candidates[0]!.scores.similarityScoreToTrigger).toBeCloseTo(1);
    expect(result.candidates[0]!.scores.runtimeCandidateScore).toBeGreaterThan(
      result.candidates[1]!.scores.runtimeCandidateScore,
    );
    expect(result.candidates[0]!.embedding.model).toBe("test-embedding-model");
    expect(result.candidates[0]!.inspiration.text).toContain("clay prototyping");
  });

  it("lets medium surprise similarity rank well when paired with stronger persisted wow score", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: public libraries as neighborhood memory systems.",
    });
    const obviousLowWow = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Obvious but low persisted signal.",
    });
    const surprisingHighWow = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Surprising bridge: seed banks as community memory infrastructure.",
    });

    await setWowScore(testDb, obviousLowWow, 0);
    await setWowScore(testDb, surprisingHighWow, 80);

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, obviousLowWow, [1, 0]);
    await createEmbedding(testDb, surprisingHighWow, [0.55, Math.sqrt(1 - 0.55 ** 2)]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 2,
    });

    expect(result.candidates[0]!.inspiration.id).toBe(surprisingHighWow.id);
    expect(result.candidates[0]!.scores.similarityScoreToTrigger).toBeCloseTo(0.55);
    expect(result.candidates[0]!.scores.surpriseSimilarityScoreToTrigger).toBeCloseTo(1);
    expect(result.candidates[0]!.scores.runtimeCandidateScore).toBeGreaterThan(
      result.candidates[1]!.scores.runtimeCandidateScore,
    );
  });

  it("does not persist runtime candidate scores or mutate persisted wow_score", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: a runtime-only candidate search.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate: should receive only an in-memory ranking score.",
    });

    await setWowScore(testDb, trigger, 12);
    await setWowScore(testDb, candidate, 34);

    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 1,
    });

    expect(result.candidates[0]!.scores.runtimeCandidateScore).toBeGreaterThan(0);

    const persistedRows = await testDb.db
      .select({ id: inspirations.id, wowScore: inspirations.wowScore })
      .from(inspirations)
      .where(eq(inspirations.userId, alice.user.id));
    const persistedById = new Map(persistedRows.map((row) => [row.id, row.wowScore]));

    expect(persistedById.get(trigger.id)).toBe(12);
    expect(persistedById.get(candidate.id)).toBe(34);
  });

  it("uses a bounded explainable DB preselection before app-side cosine ranking", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger for bounded candidate preselection.",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const perfectButLowPreselection = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Perfect cosine candidate with low durable preselection signals.",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });

    await createEmbedding(testDb, trigger, [1, 0]);
    await setWowScore(testDb, perfectButLowPreselection, 0);
    await createEmbedding(testDb, perfectButLowPreselection, [1, 0]);

    for (let index = 0; index < MAX_DB_CANDIDATE_POOL; index += 1) {
      const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
        text: `High durable preselection candidate ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index)),
      });
      await setWowScore(testDb, candidate, 100);
      await createEmbedding(testDb, candidate, [0, 1]);
    }

    const result = await findWowMomentCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 1,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.inspiration.id).not.toBe(perfectButLowPreselection.id);
    expect(result.candidates[0]!.scores.persistedWowScore).toBe(1);
  });

});
