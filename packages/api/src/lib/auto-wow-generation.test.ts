import { describe, expect, it, vi } from "vitest";

import { generateAutoWowMomentForInspiration } from "./auto-wow-generation.js";
import type { WowMomentJudgment } from "./wow-judge.js";

const db = {} as never;
const userId = "00000000-0000-4000-8000-000000000001";
const inspirationId = "00000000-0000-4000-8000-000000000002";
const relatedId = "00000000-0000-4000-8000-000000000003";

function unchangedEmbeddingResult() {
  return {
    status: "unchanged" as const,
    embedding: {} as never,
    generated: false,
    inputHash: "hash",
  };
}

describe("generateAutoWowMomentForInspiration", () => {
  it("persists a valid WOW judgment and reports generated", async () => {
    const judgment: WowMomentJudgment = {
      isWowMoment: true,
      kind: "bridge",
      title: "Bridge",
      why: "These ideas connect.",
      beliefStatement: "I think bridges make ideas feel more humane.",
      relatedInspirationIds: [relatedId],
      sourceEvidence: [
        {
          inspirationId: relatedId,
          role: "The bridge",
          reason: "This source supplies the connected idea.",
        },
      ],
    };
    const ensureEmbedding = vi.fn().mockResolvedValue(unchangedEmbeddingResult());
    const judgeWowMoment = vi.fn().mockResolvedValue(judgment);
    const persistJudgment = vi.fn().mockResolvedValue({
      persisted: true,
      status: "created",
      judgment,
      wowMoment: { id: "wow-1" },
      inspirationLinks: [{ inspirationId }],
    });

    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding,
      judgeWowMoment,
      persistJudgment,
      locale: "ko-KR",
    });

    expect(result.status).toBe("generated");
    expect(result.generated).toBe(true);
    expect(judgeWowMoment).toHaveBeenCalledWith(
      expect.objectContaining({ db, userId, triggerInspirationId: inspirationId, limit: 10, locale: "ko-KR" }),
    );
    expect(persistJudgment).toHaveBeenCalledWith(
      expect.objectContaining({ db, userId, triggerInspirationId: inspirationId, judgment, limit: 10, locale: "ko-KR" }),
    );
  });

  it("reports existing when persistence reuses an idempotent WOW moment", async () => {
    const judgment: WowMomentJudgment = {
      isWowMoment: true,
      kind: "recurrence",
      title: "Again",
      why: "It repeats.",
      beliefStatement: "I might value the signals that keep recurring.",
      relatedInspirationIds: [relatedId],
      sourceEvidence: [
        {
          inspirationId: relatedId,
          role: "The repeated signal",
          reason: "This source shows the pattern returning.",
        },
      ],
    };
    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding: vi.fn().mockResolvedValue(unchangedEmbeddingResult()),
      judgeWowMoment: vi.fn().mockResolvedValue(judgment),
      locale: "en-US",
      persistJudgment: vi.fn().mockResolvedValue({
        persisted: true,
        status: "existing",
        judgment,
        wowMoment: { id: "wow-existing" },
        inspirationLinks: [],
      }),
    });

    expect(result.status).toBe("existing");
    expect(result.generated).toBe(false);
  });

  it("reports not_wow without fallback persistence even when candidate signals are strong", async () => {
    const persistJudgment = vi.fn();
    const findCandidates = vi.fn();

    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding: vi.fn().mockResolvedValue(unchangedEmbeddingResult()),
      judgeWowMoment: vi.fn().mockResolvedValue({ isWowMoment: false, reason: "generic_similarity", debugSummary: "Only a generic topical overlap was found." }),
      persistJudgment,
      locale: "en-US",
    });

    expect(result).toMatchObject({
      status: "not_wow",
      generated: false,
      judgment: { isWowMoment: false, reason: "generic_similarity", debugSummary: "Only a generic topical overlap was found." },
    });
    expect(persistJudgment).not.toHaveBeenCalled();
    expect(findCandidates).not.toHaveBeenCalled();
  });

  it("reports not_wow without persistence", async () => {
    const persistJudgment = vi.fn();
    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding: vi.fn().mockResolvedValue(unchangedEmbeddingResult()),
      judgeWowMoment: vi.fn().mockResolvedValue({ isWowMoment: false, reason: "generic_similarity", debugSummary: "Only a generic topical overlap was found." }),
      persistJudgment,
      locale: "en-US",
    });

    expect(result.status).toBe("not_wow");
    expect(result.generated).toBe(false);
    expect(persistJudgment).not.toHaveBeenCalled();
  });

  it("keeps tenant/missing inspiration safe", async () => {
    const judgeWowMoment = vi.fn();
    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding: vi.fn().mockResolvedValue({
        status: "missing_inspiration",
        embedding: null,
        generated: false,
        inputHash: null,
      }),
      judgeWowMoment,
      persistJudgment: vi.fn(),
    });

    expect(result.status).toBe("missing_inspiration");
    expect(result.generated).toBe(false);
    expect(judgeWowMoment).not.toHaveBeenCalled();
  });

  it("reports stale_source without judging", async () => {
    const judgeWowMoment = vi.fn();
    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding: vi.fn().mockResolvedValue({
        status: "stale_source",
        embedding: null,
        generated: true,
        inputHash: "hash",
      }),
      judgeWowMoment,
      persistJudgment: vi.fn(),
    });

    expect(result.status).toBe("stale_source");
    expect(judgeWowMoment).not.toHaveBeenCalled();
  });

  it("swallows provider/runtime errors as unavailable", async () => {
    const result = await generateAutoWowMomentForInspiration({
      db,
      userId,
      inspirationId,
      ensureEmbedding: vi.fn().mockRejectedValue(new Error("secret-bearing provider failure")),
      judgeWowMoment: vi.fn(),
      persistJudgment: vi.fn(),
    });

    expect(result).toEqual({ status: "unavailable", generated: false });
  });
});
