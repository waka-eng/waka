import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import {
  meaningEdges,
  meaningEvidence,
  meaningNodes,
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

  it("promotes packet evidence into meaning nodes and meaning edges", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "AI makes building faster, but choosing what to build, who to build with, and why it matters gets harder.",
      importanceScore: 70,
      wowScore: 80,
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Cities and peers quietly shape the ambitions people believe are available to them.",
      importanceScore: 64,
      wowScore: 72,
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);

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
    expect(result.nodes.length).toBeGreaterThan(1);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      userId: alice.user.id,
      kind: "points_to",
      confidence: 88,
      status: "active",
      source: "meaning_graph_writer",
    });

    const persistedNodes = await testDb.db
      .select()
      .from(meaningNodes)
      .where(eq(meaningNodes.userId, alice.user.id));
    const persistedEvidence = await testDb.db
      .select()
      .from(meaningEvidence)
      .where(eq(meaningEvidence.userId, alice.user.id));
    const persistedEdges = await testDb.db
      .select()
      .from(meaningEdges)
      .where(eq(meaningEdges.userId, alice.user.id));

    expect(persistedNodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(["question", "environment"]),
    );
    expect(persistedNodes.map((node) => node.label)).toEqual(
      expect.arrayContaining([
        "what is worth building when building itself gets cheap",
        "rooms where people can be honest before they are impressive",
      ]),
    );
    expect(persistedEvidence.map((row) => row.inspirationId)).toEqual(
      expect.arrayContaining([trigger.id, candidate.id]),
    );
    expect(persistedEdges).toHaveLength(1);
    expect(persistedEdges[0]!.evidenceInspirationIds).toContain(trigger.id);
  }, 30000);

  it("is idempotent and reinforces existing meaning nodes and edges", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "AI makes building faster while people feel less grounded.",
      importanceScore: 55,
      wowScore: 66,
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "A hacker house is an environment where builders can feel less alone.",
      importanceScore: 60,
      wowScore: 70,
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: true,
        relationships: [
          {
            kind: "resonates_with",
            fromInspirationId: trigger.id,
            toInspirationId: candidate.id,
            confidence: 82,
            reason: "Both saves connect AI acceleration to the need for better human environments.",
            evidence: [
              { inspirationId: trigger.id, label: "The tension", reason: "Speed creates disorientation." },
              { inspirationId: candidate.id, label: "The environment", reason: "Place answers the loneliness." },
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

    const persistedEdges = await testDb.db
      .select()
      .from(meaningEdges)
      .where(eq(meaningEdges.userId, alice.user.id));
    const persistedEvidence = await testDb.db
      .select()
      .from(meaningEvidence)
      .where(eq(meaningEvidence.userId, alice.user.id));

    expect(first.edges).toHaveLength(1);
    expect(second.edges).toHaveLength(1);
    expect(second.edges[0]!.id).toBe(first.edges[0]!.id);
    expect(persistedEdges).toHaveLength(1);
    expect(persistedEdges[0]!.evidenceCount).toBe(1);
    expect(persistedEvidence.length).toBeGreaterThan(0);
  }, 30000);

  it("creates conservative graph edges from WAKA candidates when the relationship judge returns no proposal", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "AI makes building faster, but choosing what to build and why it matters still feels harder.",
      importanceScore: 76,
      wowScore: 82,
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Good rooms and peers shape which ambitions people can honestly hold.",
      importanceScore: 68,
      wowScore: 74,
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: false,
        reason: "weak_relationship",
        debugSummary: "The model declined to label the relationship.",
      }),
    };

    const result = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.judgmentResult.status).toBe("judged");
    expect(result.judgmentResult.proposals).toEqual([]);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    expect(result.edges[0]).toMatchObject({
      userId: alice.user.id,
      kind: "supports",
      status: "active",
      source: "meaning_graph_writer",
    });

    const persistedNodes = await testDb.db
      .select()
      .from(meaningNodes)
      .where(eq(meaningNodes.userId, alice.user.id));
    const persistedEdges = await testDb.db
      .select()
      .from(meaningEdges)
      .where(eq(meaningEdges.userId, alice.user.id));

    expect(persistedNodes.map((node) => node.type)).toContain("claim");
    expect(persistedEdges.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("keeps deterministic edges when preferred endpoints collapse to the same durable node", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "AI makes writing and building faster, but choosing what to build still matters more than speed.",
      importanceScore: 72,
      wowScore: 78,
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "AI agents make prototypes cheap, so the harder question is why this product should exist.",
      importanceScore: 69,
      wowScore: 75,
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: false,
        reason: "weak_relationship",
        debugSummary: "The model declined to label the relationship.",
      }),
    };

    const result = await persistMeaningGraphForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    expect(result.edges[0]!.sourceNodeId).not.toBe(result.edges[0]!.targetNodeId);

    const persistedEdges = await testDb.db
      .select()
      .from(meaningEdges)
      .where(eq(meaningEdges.userId, alice.user.id));
    expect(persistedEdges.length).toBeGreaterThanOrEqual(1);
    expect(persistedEdges[0]!.sourceNodeId).not.toBe(persistedEdges[0]!.targetNodeId);
  }, 30000);

  it("writes no meaning graph rows when the trigger has no meaning packet", async () => {
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
    expect(result.nodes).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(client.judgeMeaningRelationships).not.toHaveBeenCalled();
  });
});
