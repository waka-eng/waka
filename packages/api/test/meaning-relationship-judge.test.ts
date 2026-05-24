import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  inspirationEmbeddings,
  type Inspiration,
} from "../src/db/index.js";
import {
  GeminiMeaningRelationshipJudgeClient,
  judgeMeaningRelationshipsForInspiration,
  type MeaningRelationshipJudgeClient,
} from "../src/lib/meaning-relationship-judge.js";
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

function geminiJsonResponse(body: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("judgeMeaningRelationshipsForInspiration", () => {
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

  it("returns missing_trigger_packet without calling the judge when the trigger is not packetized", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger exists but does not have a packet yet.",
    });
    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn(),
    };

    const result = await judgeMeaningRelationshipsForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.status).toBe("missing_trigger_packet");
    expect(result.proposals).toEqual([]);
    expect(client.judgeMeaningRelationships).not.toHaveBeenCalled();
  });

  it("returns not_enough_candidates without calling the judge when no bounded candidates exist", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger has a packet but no other saved meaning packets.",
    });
    await createPacket(testDb, alice.user.id, trigger);
    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn(),
    };

    const result = await judgeMeaningRelationshipsForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.status).toBe("not_enough_candidates");
    expect(result.proposals).toEqual([]);
    expect(client.judgeMeaningRelationships).not.toHaveBeenCalled();
  });

  it("judges compact packet candidates and returns safe relationship proposals", async () => {
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
            reason: "The city note clarifies why choosing collaborators is part of choosing an environment.",
            evidence: [
              {
                inspirationId: trigger.id,
                label: "The question",
                reason: "The trigger names the harder choice underneath faster building.",
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

    const result = await judgeMeaningRelationshipsForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.status).toBe("judged");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      kind: "clarifies",
      fromInspirationId: trigger.id,
      toInspirationId: candidate.id,
      confidence: 88,
    });
    expect(client.judgeMeaningRelationships).toHaveBeenCalledTimes(1);
    const input = vi.mocked(client.judgeMeaningRelationships).mock.calls[0]![0];
    expect(input.trigger.packetText).toContain("waka.meaning_packet.v1");
    expect(input.candidates[0]!.packetText).toContain("Cities and peers");
    expect(input.candidates[0]!.scores.runtimeMeaningCandidateScore).toEqual(
      expect.any(Number),
    );
  });

  it("rejects proposals that reference ids outside the bounded candidate set", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger for unsafe relationship test.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Safe candidate for unsafe relationship test.",
    });
    const unsafeId = "00000000-0000-4000-8000-000000000099";
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: true,
        relationships: [
          {
            kind: "extends",
            fromInspirationId: trigger.id,
            toInspirationId: unsafeId,
            confidence: 90,
            reason: "This should be rejected because the target was not retrieved.",
            evidence: [
              {
                inspirationId: trigger.id,
                label: "The trigger",
                reason: "Safe trigger evidence.",
              },
              {
                inspirationId: unsafeId,
                label: "The unsafe target",
                reason: "Unsafe candidate evidence.",
              },
            ],
          },
        ],
      }),
    };

    const result = await judgeMeaningRelationshipsForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.status).toBe("unsafe_judgment");
    expect(result.proposals).toEqual([]);
    expect(result.judgment).toMatchObject({
      hasMeaningfulRelationships: false,
      reason: "unsafe_candidate_ids",
    });
  });

  it("passes through safe false judgments without proposals", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger with weak relationship.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate with only generic overlap.",
    });
    await createPacket(testDb, alice.user.id, trigger);
    await createPacket(testDb, alice.user.id, candidate);
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [1, 0]);

    const client: MeaningRelationshipJudgeClient = {
      judgeMeaningRelationships: vi.fn().mockResolvedValue({
        hasMeaningfulRelationships: false,
        reason: "generic_similarity",
        debugSummary: "The packets overlap topically but do not form a concrete relationship.",
      }),
    };

    const result = await judgeMeaningRelationshipsForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result.status).toBe("judged");
    expect(result.proposals).toEqual([]);
    expect(result.judgment).toMatchObject({
      hasMeaningfulRelationships: false,
      reason: "generic_similarity",
    });
  });
});

describe("GeminiMeaningRelationshipJudgeClient", () => {
  it("serializes compact packet text and parses a true judgment", async () => {
    const triggerId = "00000000-0000-4000-8000-000000000001";
    const candidateId = "00000000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn().mockResolvedValue(
      geminiJsonResponse({
        hasMeaningfulRelationships: true,
        relationships: [
          {
            kind: "resonates_with",
            fromInspirationId: triggerId,
            toInspirationId: candidateId,
            confidence: 82,
            reason: "Both packets circle the same underlying question from different angles.",
            evidence: [
              {
                inspirationId: triggerId,
                label: "The question",
                reason: "The trigger names the question directly.",
              },
              {
                inspirationId: candidateId,
                label: "The echo",
                reason: "The candidate returns to the same concern.",
              },
            ],
          },
        ],
      }),
    );
    const client = new GeminiMeaningRelationshipJudgeClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    const result = await client.judgeMeaningRelationships({
      trigger: {
        inspirationId: triggerId,
        packetId: "packet-trigger",
        packetText: "waka.meaning_packet.v1\nSPARKS\nchoosing what to build",
        sparkText: "choosing what to build",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        cluster: "bridge",
      },
      candidates: [
        {
          inspirationId: candidateId,
          packetId: "packet-candidate",
          packetText: "waka.meaning_packet.v1\nSPARKS\nchoosing who to build with",
          sparkText: "choosing who to build with",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          cluster: "loop",
          scores: {
            runtimeMeaningCandidateScore: 0.8,
            source: "embedding_similarity",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      hasMeaningfulRelationships: true,
      relationships: [{ kind: "resonates_with", confidence: 82 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const prompt = request.contents[0].parts[0].text as string;
    expect(prompt).toContain("waka.meaning_packet.v1");
    expect(prompt).toContain(candidateId);
    expect(prompt).toContain("allowedCandidateIds");
  });

  it("fails safely when Gemini returns invalid judgment JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{not json" }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new GeminiMeaningRelationshipJudgeClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    await expect(
      client.judgeMeaningRelationships({
        trigger: {
          inspirationId: "trigger",
          packetId: "packet-trigger",
          packetText: "trigger packet",
          sparkText: "",
          createdAt: new Date(),
          cluster: null,
        },
        candidates: [
          {
            inspirationId: "candidate",
            packetId: "packet-candidate",
            packetText: "candidate packet",
            sparkText: "",
            createdAt: new Date(),
            cluster: null,
            scores: {
              runtimeMeaningCandidateScore: 0.5,
              source: "durable_signal",
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      hasMeaningfulRelationships: false,
      reason: "unclear_pattern",
    });
  });
});
