import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import {
  inspirationEmbeddings,
  inspirations,
  meaningPackets,
  type Inspiration,
} from "../src/db/index.js";
import { findMeaningPacketCandidates } from "../src/lib/meaning-candidates.js";
import { persistMeaningPacketForInspiration } from "../src/lib/meaning-packets.js";

import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

async function createPacket(
  testDb: TestDatabase,
  userId: string,
  inspiration: Inspiration,
): Promise<void> {
  const result = await persistMeaningPacketForInspiration({
    db: testDb.db,
    userId,
    inspirationId: inspiration.id,
  });
  expect(result.status).toBe("created_or_updated");
}

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

describe("findMeaningPacketCandidates", () => {
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

  it("returns compact packet candidates for same-user embedded inspirations", async () => {
    const alice = await createUserFixture(testDb.db);
    const bob = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: choosing where to build and who to build with.",
    });
    const aliceCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Alice candidate: cities shape ambition through the people nearby.",
    });
    const bobCandidate = await createInspirationFixture(testDb.db, bob.user.id, {
      text: "Bob candidate: similar but owned by another tenant.",
    });

    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, aliceCandidate);
    await createPacket(testDb, bob.user.id, bobCandidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, aliceCandidate, [1, 0]);
    await createEmbedding(testDb, bobCandidate, [1, 0]);

    const result = await findMeaningPacketCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 10,
    });

    expect(result.trigger?.inspiration.id).toBe(trigger.id);
    expect(result.trigger?.packet.packetText).toContain("choosing where to build");
    expect(result.candidates.map((candidate) => candidate.inspiration.id)).toEqual([
      aliceCandidate.id,
    ]);
    expect(result.candidates[0]!.packet.packetText).toContain("cities shape ambition");
    expect(result.candidates[0]!.scores.source).toBe("embedding_similarity");
    expect(result.candidates[0]!.scores.similarityScoreToTrigger).toBeCloseTo(1);
  });

  it("falls back to durable packet signals when the trigger has no embedding", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger with no embedding but a meaning packet.",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const oldHighSignal = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Older high-signal candidate about recurring ambition.",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const recentLowSignal = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Recent low-signal candidate about today's context.",
      createdAt: new Date("2026-03-31T00:00:00.000Z"),
    });

    await setWowScore(testDb, oldHighSignal, 100);
    await setWowScore(testDb, recentLowSignal, 10);
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, oldHighSignal);
    await createPacket(testDb, alice.user.id, recentLowSignal);

    const result = await findMeaningPacketCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 2,
    });

    expect(result.trigger?.inspiration.id).toBe(trigger.id);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.inspiration.id).toBe(oldHighSignal.id);
    expect(result.candidates.every((candidate) => candidate.scores.source === "durable_signal")).toBe(true);
    expect(result.candidates[0]!.packet.packetText).toContain("Older high-signal");
  });

  it("requires a trigger meaning packet before returning candidates", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger exists but has not been packetized yet.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate has a packet.",
    });

    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const result = await findMeaningPacketCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 10,
    });

    expect(result).toEqual({ trigger: null, candidates: [] });
  });

  it("caps the final result and ignores embedded inspirations without packets", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger for bounded packet candidate selection.",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const noPacketCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Embedded candidate without a meaning packet should be ignored.",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const packetCandidates: Inspiration[] = [];

    await createPacket(testDb, alice.user.id, trigger);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, noPacketCandidate, [1, 0]);

    for (let index = 0; index < 5; index += 1) {
      const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
        text: `Packet candidate ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 3, 0, 0, index)),
      });
      await setWowScore(testDb, candidate, 50 + index);
      await createPacket(testDb, alice.user.id, candidate);
      await createEmbedding(testDb, candidate, [1, 0]);
      packetCandidates.push(candidate);
    }

    const result = await findMeaningPacketCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 3,
    });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((candidate) => candidate.inspiration.id)).not.toContain(
      noPacketCandidate.id,
    );
    for (const candidate of result.candidates) {
      expect(candidate.packet.packetText).toContain("waka.meaning_packet.v1");
      expect(candidate.packet.tokenEstimate).toBeGreaterThan(0);
    }
    const persistedRows = await testDb.db
      .select({ id: meaningPackets.id })
      .from(meaningPackets)
      .where(eq(meaningPackets.userId, alice.user.id));
    expect(persistedRows).toHaveLength(6);
    expect(packetCandidates).toHaveLength(5);
  });

  it("returns the trigger but no candidates when limit is zero", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger with zero requested meaning candidates.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate should be skipped by limit zero.",
    });

    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const result = await findMeaningPacketCandidates({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 0,
    });

    expect(result.trigger?.inspiration.id).toBe(trigger.id);
    expect(result.candidates).toEqual([]);
  });
});
