import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { inspirationEmbeddings, type Inspiration } from "../src/db/index.js";
import {
  GeminiWowJudgeClient,
  GeminiWowJudgeValidationError,
  buildWowJudgmentRequest,
  judgeWowMomentForInspiration,
  type WowJudgeClient,
} from "../src/lib/wow-judge.js";

import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

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

async function countWowMoments(testDb: TestDatabase): Promise<number> {
  const result = await testDb.sql<{ count: string }[]>`SELECT count(*) FROM wow_moments`;
  return Number(result[0]?.count ?? 0);
}

function geminiJsonResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(value) }] },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("GeminiWowJudgeClient", () => {
  it("returns a validated true WOW judgment from Gemini JSON", async () => {
    const triggerId = "00000000-0000-4000-8000-000000000001";
    const candidateId = "00000000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn().mockResolvedValue(
      geminiJsonResponse({
        isWowMoment: true,
        kind: "bridge",
        title: "Libraries as Memory Gardens",
        why: "Both notes point at shared memory infrastructure in physical places.",
        reflectionQuestion: "What other civic spaces behave like memory systems?",
        relatedInspirationIds: [triggerId, candidateId],
      }),
    );
    const client = new GeminiWowJudgeClient({ apiKey: "test-key", fetchFn: fetchMock });

    const result = await client.judgeWowMoment({
      trigger: {
        id: triggerId,
        text: "Libraries as neighborhood memory systems.",
        kind: "note",
        category: null,
        cluster: "bridge",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
      candidates: [
        {
          id: candidateId,
          text: "Seed banks as community memory infrastructure.",
          kind: "note",
          category: null,
          cluster: "bridge",
          createdAt: new Date("2024-01-15T00:00:00Z"),
          scores: { runtimeCandidateScore: 0.9 },
        },
      ],
    });

    expect(result).toEqual({
      isWowMoment: true,
      kind: "bridge",
      title: "Libraries as Memory Gardens",
      why: "Both notes point at shared memory infrastructure in physical places.",
      reflectionQuestion: "What other civic spaces behave like memory systems?",
      relatedInspirationIds: [triggerId, candidateId],
    });
  });

  it("returns a validated false WOW judgment from Gemini JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(geminiJsonResponse({ isWowMoment: false }));
    const client = new GeminiWowJudgeClient({ apiKey: "test-key", fetchFn: fetchMock });

    await expect(
      client.judgeWowMoment({
        trigger: {
          id: "trigger-id",
          text: "A standalone note.",
          kind: null,
          category: null,
          cluster: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
        candidates: [],
      }),
    ).resolves.toEqual({ isWowMoment: false });
  });

  it("rejects an invalid WOW kind", async () => {
    const triggerId = "00000000-0000-4000-8000-000000000003";
    const fetchMock = vi.fn().mockResolvedValue(
      geminiJsonResponse({
        isWowMoment: true,
        kind: "not_a_wow_kind",
        title: "Invalid",
        why: "Invalid kind should not be accepted.",
        relatedInspirationIds: [triggerId],
      }),
    );
    const client = new GeminiWowJudgeClient({ apiKey: "test-key", fetchFn: fetchMock });

    await expect(
      client.judgeWowMoment({
        trigger: {
          id: triggerId,
          text: "Trigger.",
          kind: null,
          category: null,
          cluster: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
        candidates: [],
      }),
    ).rejects.toBeInstanceOf(GeminiWowJudgeValidationError);
  });

  it("builds a bounded prompt from only the trigger and provided candidates", () => {
    const request = buildWowJudgmentRequest({
      trigger: {
        id: "trigger-id",
        text: "TRIGGER_TEXT_INCLUDED",
        kind: null,
        category: null,
        cluster: null,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
      candidates: [
        {
          id: "candidate-id",
          text: "TOP_CANDIDATE_INCLUDED",
          kind: null,
          category: null,
          cluster: null,
          createdAt: new Date("2024-01-02T00:00:00Z"),
          scores: { runtimeCandidateScore: 0.75 },
        },
      ],
    });
    const requestText = JSON.stringify(request);

    expect(requestText).toContain("TRIGGER_TEXT_INCLUDED");
    expect(requestText).toContain("TOP_CANDIDATE_INCLUDED");
    expect(requestText).not.toContain("FULL_ARCHIVE");
    expect(requestText).not.toContain("not provided");
  });
});

describe("judgeWowMomentForInspiration", () => {
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

  it("retrieves top candidates, returns a valid true judgment, and does not write wow_moments", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: public libraries as neighborhood memory systems.",
    });
    const candidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate: seed banks as community memory infrastructure.",
    });
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, candidate, [0.55, Math.sqrt(1 - 0.55 ** 2)]);

    const client: WowJudgeClient = {
      judgeWowMoment: vi.fn().mockResolvedValue({
        isWowMoment: true,
        kind: "surprise_bridge",
        title: "Community Memory Infrastructure",
        why: "The trigger and candidate bridge civic and ecological memory systems.",
        relatedInspirationIds: [trigger.id, candidate.id],
      }),
    };

    const result = await judgeWowMomentForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 5,
      client,
    });

    expect(result).toEqual({
      isWowMoment: true,
      kind: "surprise_bridge",
      title: "Community Memory Infrastructure",
      why: "The trigger and candidate bridge civic and ecological memory systems.",
      relatedInspirationIds: [trigger.id, candidate.id],
    });
    expect(client.judgeWowMoment).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({ id: trigger.id }),
        candidates: [expect.objectContaining({ id: candidate.id })],
      }),
    );
    expect(await countWowMoments(testDb)).toBe(0);
  });

  it("returns false without calling Gemini when there is no trigger embedding", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger without embedding.",
    });
    const client: WowJudgeClient = { judgeWowMoment: vi.fn() };

    const result = await judgeWowMomentForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      client,
    });

    expect(result).toEqual({ isWowMoment: false });
    expect(client.judgeWowMoment).not.toHaveBeenCalled();
    expect(await countWowMoments(testDb)).toBe(0);
  });

  it("rejects related ids outside the trigger plus same-tenant retrieved candidates", async () => {
    const alice = await createUserFixture(testDb.db);
    const bob = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: local-first notebooks.",
    });
    const aliceCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Candidate: offline garden maps.",
    });
    const bobInspiration = await createInspirationFixture(testDb.db, bob.user.id, {
      text: "Wrong tenant candidate.",
    });
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, aliceCandidate, [1, 0]);
    await createEmbedding(testDb, bobInspiration, [1, 0]);

    const client: WowJudgeClient = {
      judgeWowMoment: vi.fn().mockResolvedValue({
        isWowMoment: true,
        kind: "bridge",
        title: "Unsafe relation",
        why: "The model included an id outside the safe set.",
        relatedInspirationIds: [trigger.id, bobInspiration.id],
      }),
    };

    await expect(
      judgeWowMomentForInspiration({
        db: testDb.db,
        userId: alice.user.id,
        triggerInspirationId: trigger.id,
        limit: 5,
        client,
      }),
    ).rejects.toBeInstanceOf(GeminiWowJudgeValidationError);
    expect(await countWowMoments(testDb)).toBe(0);
  });

  it("sends only retrieved top candidates to the judge client", async () => {
    const alice = await createUserFixture(testDb.db);
    const trigger = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Trigger: TOP_TRIGGER_TEXT.",
    });
    const topCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "TOP_CANDIDATE_TEXT.",
    });
    const extraCandidate = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "FULL_ARCHIVE_SHOULD_NOT_BE_SENT.",
    });
    await testDb.sql`
      UPDATE inspirations
      SET wow_score = 100
      WHERE id = ${topCandidate.id}
    `;
    await testDb.sql`
      UPDATE inspirations
      SET wow_score = 0
      WHERE id = ${extraCandidate.id}
    `;
    await createEmbedding(testDb, trigger, [1, 0]);
    await createEmbedding(testDb, topCandidate, [1, 0]);
    await createEmbedding(testDb, extraCandidate, [0, 1]);

    const client: WowJudgeClient = {
      judgeWowMoment: vi.fn().mockResolvedValue({ isWowMoment: false }),
    };

    await judgeWowMomentForInspiration({
      db: testDb.db,
      userId: alice.user.id,
      triggerInspirationId: trigger.id,
      limit: 1,
      client,
    });

    expect(client.judgeWowMoment).toHaveBeenCalledTimes(1);
    const input = vi.mocked(client.judgeWowMoment).mock.calls[0]![0];
    expect(input.trigger.text).toContain("TOP_TRIGGER_TEXT");
    expect(input.candidates.map((candidate) => candidate.text)).toEqual([
      "TOP_CANDIDATE_TEXT.",
    ]);
    expect(JSON.stringify(input)).not.toContain("FULL_ARCHIVE_SHOULD_NOT_BE_SENT");
    expect(await countWowMoments(testDb)).toBe(0);
  });
});
