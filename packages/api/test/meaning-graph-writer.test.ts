import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import {
  inspirationEmbeddings,
  meaningGraphEdges,
  meaningGraphNodes,
  type Inspiration,
} from "../src/db/index.js";
import { persistMeaningGraphForInspiration } from "../src/lib/meaning-graph-writer.js";
import type { MeaningRelationshipJudgeClient } from "../src/lib/meaning-relationship-judge.js";
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

describe("persistMeaningGraphForInspiration", () => {
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

  it("creates internal graph nodes and edges from safe relationship proposals", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "AI makes building faster, but choosing what to build and with whom gets harder.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Cities and peers quietly shape the ambitions people believe are available to them.",
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: true,
        relationships: [
          {
            kind: "clarifies",
            fromInspirationId: trigger.id,
            toInspirationId: candidate.id,
            confidence: 88,
            reason: "The city note clarifies why collaborators are part of environment design.",
            evidence: [
              {
                inspirationId: trigger.id,
                label: "The question",
                reason: "The trigger names the harder choice under faster building.",
              },
              {
                inspirationId: candidate.id,
                label: "The environment",
                reason: "The candidate shows how peers and place shape ambition.",
              },
            ],
          },
        ],
      }),
    };

    const result = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.judgmentResult.status).toBe("judged");
    expect(result.triggerNode?.inspirationId).toBe(trigger.id);
    expect(result.nodes.map((node) => node.inspirationId).sort()).toEqual(
      [trigger.id, candidate.id].sort(),
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      userId: alice.user.id,
      fromInspirationId: trigger.id,
      toInspirationId: candidate.id,
      kind: "clarifies",
      confidence: 88,
      status: "active",
      source: "meaning_relationship_judge",
    });

    const persistedNodes = await testDb.db
      .select()
      .from(meaningGraphNodes)
      .where(eq(meaningGraphNodes.userId, alice.user.id));
    const persistedEdges = await testDb.db
      .select()
      .from(meaningGraphEdges)
      .where(eq(meaningGraphEdges.userId, alice.user.id));

    expect(persistedNodes).toHaveLength(2);
    expect(persistedEdges).toHaveLength(1);
    expect(persistedEdges[0]!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inspirationId: trigger.id }),
        expect.objectContaining({ inspirationId: candidate.id }),
      ]),
    );
  });

  it("is idempotent and updates an existing edge instead of duplicating it", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger for idempotent graph edge persistence.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate for idempotent graph edge persistence.",
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi
        .fn()
        .mockResolvedValueOnce({
          hasMeaningfulRelationships: true,
          relationships: [
            {
              kind: "extends",
              fromInspirationId: trigger.id,
              toInspirationId: candidate.id,
              confidence: 70,
              reason: "Initial reason.",
              evidence: [
                { inspirationId: trigger.id, label: "Trigger", reason: "Initial trigger." },
                { inspirationId: candidate.id, label: "Candidate", reason: "Initial candidate." },
              ],
            },
          ],
        })
        .mockResolvedValueOnce({
          hasMeaningfulRelationships: true,
          relationships: [
            {
              kind: "extends",
              fromInspirationId: trigger.id,
              toInspirationId: candidate.id,
              confidence: 91,
              reason: "Updated reason.",
              evidence: [
                { inspirationId: trigger.id, label: "Trigger", reason: "Updated trigger." },
                { inspirationId: candidate.id, label: "Candidate", reason: "Updated candidate." },
              ],
            },
          ],
        }),
    };

    const first = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });
    const second = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(first.edges).toHaveLength(1);
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0]!.id).toBe(first.edges[0]!.id);
    expect(second.edges[0]!.confidence).toBe(91);
    expect(second.edges[0]!.reason).toBe("Updated reason.");

    const persistedEdges = await testDb.db
      .select()
      .from(meaningGraphEdges)
      .where(eq(meaningGraphEdges.userId, alice.user.id));
    const persistedNodes = await testDb.db
      .select()
      .from(meaningGraphNodes)
      .where(eq(meaningGraphNodes.userId, alice.user.id));

    expect(persistedEdges).toHaveLength(1);
    expect(persistedNodes).toHaveLength(2);
  });

  it("creates only the trigger node when the judge returns no proposals", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger that should become an internal graph node.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate that should not become a node without an accepted edge.",
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: false,
        reason: "generic_similarity",
        debugSummary: "Only generic topical overlap.",
      }),
    };

    const result = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.edges).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.inspirationId).toBe(trigger.id);

    const persistedNodes = await testDb.db
      .select()
      .from(meaningGraphNodes)
      .where(eq(meaningGraphNodes.userId, alice.user.id));
    const persistedEdges = await testDb.db
      .select()
      .from(meaningGraphEdges)
      .where(eq(meaningGraphEdges.userId, alice.user.id));

    expect(persistedNodes).toHaveLength(1);
    expect(persistedEdges).toHaveLength(0);
  });

  it("writes nothing when the trigger has no meaning packet", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Unpacketized trigger.",
    });
    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn(),
    };

    const result = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.judgmentResult.status).toBe("missing_trigger_packet");
    expect(result.triggerNode).toBeNull();
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(client.judgeMeaningRelationships).not.toHaveBeenCalled();
  });
});
