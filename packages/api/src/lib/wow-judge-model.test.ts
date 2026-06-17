import { describe, expect, it } from "vitest";

import {
  buildWowGenerateContentUrl,
  buildWowJudgmentRequest,
  buildWowRepairJudgmentRequest,
  parseWowJudgmentFromResponse,
  type WowJudgeInput,
} from "./wow-judge.js";

const triggerId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const otherCandidateId = "33333333-3333-4333-8333-333333333333";

const sampleInput: WowJudgeInput = {
  locale: "en-US",
  trigger: {
    id: triggerId,
    text: "I keep wanting a room where rough ambitious work can be visible before it is impressive.",
    kind: "note",
    category: 1,
    cluster: "ambition-rooms",
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
  },
  candidates: [
    {
      id: candidateId,
      text: "The people I admire make courage feel normal by building in public while things are unfinished.",
      kind: "note",
      category: 2,
      cluster: "ambition-rooms",
      createdAt: new Date("2026-06-02T12:00:00.000Z"),
      scores: { runtimeCandidateScore: 0.91 },
    },
    {
      id: otherCandidateId,
      text: "Taste gets sharper when it is tested outside private drafts.",
      kind: "note",
      category: 3,
      cluster: "taste-tests",
      createdAt: new Date("2026-06-03T12:00:00.000Z"),
      scores: { runtimeCandidateScore: 0.75 },
    },
  ],
};

function geminiEnvelope(text: string) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
  };
}

describe("wow judge Gemini model endpoint", () => {
  it("uses the configured Gemini flash-lite model endpoint", () => {
    expect(buildWowGenerateContentUrl()).toContain(
      "/models/gemini-3.1-flash-lite:generateContent",
    );
  });
});

describe("wow judge concrete contract", () => {
  it("builds a JSON-parseable user payload with concrete input and output contract", () => {
    const request = buildWowJudgmentRequest(sampleInput);
    const payload = JSON.parse(request.contents[0]?.parts[0]?.text ?? "{}");

    expect(payload).toMatchObject({
      contractVersion: "wow_judge_v1",
      allowedIds: [triggerId, candidateId, otherCandidateId],
    });
    expect(payload.input.trigger).toMatchObject({
      id: triggerId,
      untrustedUserContent: sampleInput.trigger.text,
    });
    expect(payload.input.candidates).toHaveLength(2);
    expect(payload.input.candidates[0]).toMatchObject({
      id: candidateId,
      rank: 1,
      runtimeCandidateScore: 0.91,
      untrustedUserContent: sampleInput.candidates[0]?.text,
    });
    expect(payload.outputContract.falseShape.required.reason).not.toContain(
      "invalid_judge_json",
    );
    expect(
      payload.outputContract.falseShape.reservedInternalOnlyReasons,
    ).toContain("invalid_judge_json");
    expect(payload.outputContract.trueShape.sourceIdRules).toMatchObject({
      allowedIdsOnly: true,
      triggerIdMustBeFirst: true,
      sourceEvidenceMustIncludeEveryRelatedInspirationId: true,
    });
    expect(payload.validExamples.false).toEqual({
      isWowMoment: false,
      reason: "weak_relationship",
      debugSummary: "Shared topic, but no concrete new pattern.",
    });
    expect(payload.validExamples.true.relatedInspirationIds).toEqual([
      triggerId,
      candidateId,
    ]);
  });

  it("keeps Gemini JSON mode and excludes invalid_judge_json from model false reasons", () => {
    const request = buildWowJudgmentRequest(sampleInput);
    const schema = request.generationConfig.responseSchema as {
      anyOf: Array<{ properties: { reason?: { enum?: string[] } } }>;
    };

    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(schema.anyOf[0]?.properties.reason?.enum).toEqual([
      "not_enough_candidates",
      "generic_similarity",
      "weak_relationship",
      "duplicate_or_rephrasing",
      "insufficient_surprise",
      "unclear_pattern",
    ]);
  });

  it("repair prompts reuse the same contract and fallback false object", () => {
    const request = buildWowRepairJudgmentRequest("not json", sampleInput);
    const payload = JSON.parse(request.contents[0]?.parts[0]?.text ?? "{}");

    expect(payload.contractVersion).toBe("wow_judge_v1");
    expect(payload.allowedIds).toEqual([
      triggerId,
      candidateId,
      otherCandidateId,
    ]);
    expect(payload.outputContract.falseShape.required.reason).not.toContain(
      "invalid_judge_json",
    );
    expect(payload.fallbackFalse).toEqual({
      isWowMoment: false,
      reason: "unclear_pattern",
      debugSummary: "Could not safely repair prior top-of-mind judge output.",
    });
    expect(payload.rawPriorOutput).toBe("not json");
  });

  it("accepts valid false and true Gemini envelopes matching the contract", () => {
    const falseJudgment = parseWowJudgmentFromResponse(
      geminiEnvelope(
        JSON.stringify({
          isWowMoment: false,
          reason: "weak_relationship",
          debugSummary: "Shared topic, but no concrete new pattern.",
        }),
      ),
    );
    expect(falseJudgment).toMatchObject({
      isWowMoment: false,
      reason: "weak_relationship",
    });

    const trueJudgment = parseWowJudgmentFromResponse(
      geminiEnvelope(
        JSON.stringify({
          isWowMoment: true,
          kind: "bridge",
          title: "Rooms that make building feel possible",
          why: "Two signals point to environments where unfinished ambition feels easier to show.",
          beliefStatement: "rooms where unfinished ambition is allowed",
          relatedInspirationIds: [triggerId, candidateId],
          sourceEvidence: [
            {
              inspirationId: triggerId,
              role: "The atmosphere",
              reason:
                "Shows the kind of setting that changes how ambition feels.",
            },
            {
              inspirationId: candidateId,
              role: "The repeated signal",
              reason:
                "Echoes the desire for building near people who make courage normal.",
            },
          ],
        }),
      ),
    );
    expect(trueJudgment).toMatchObject({
      isWowMoment: true,
      kind: "bridge",
      relatedInspirationIds: [triggerId, candidateId],
    });
  });

  it("accepts soft aphoristic belief fragments from live WOW judge output", () => {
    for (const beliefStatement of [
      "letting go is not weakness but the prerequisite for new growth",
      "build the future through the quiet architecture of daily choices",
    ]) {
      const judgment = parseWowJudgmentFromResponse(
        geminiEnvelope(
          JSON.stringify({
            isWowMoment: true,
            kind: "bridge",
            title: "Quiet Growth",
            why: "Two signals connect release with deliberate future-building.",
            beliefStatement,
            relatedInspirationIds: [triggerId, candidateId],
            sourceEvidence: [
              {
                inspirationId: triggerId,
                role: "The release",
                reason: "Frames letting go as part of growth.",
              },
              {
                inspirationId: candidateId,
                role: "The daily practice",
                reason: "Grounds future-building in daily choices.",
              },
            ],
          }),
        ),
      );

      expect(judgment).toMatchObject({
        isWowMoment: true,
        beliefStatement,
      });
    }
  });

  it("normalizes model-authored invalid_judge_json instead of accepting it as a model reason", () => {
    const judgment = parseWowJudgmentFromResponse(
      geminiEnvelope(
        JSON.stringify({
          isWowMoment: false,
          reason: "invalid_judge_json",
          debugSummary: "I should not be able to emit this reserved reason.",
        }),
      ),
    );

    expect(judgment).toEqual({
      isWowMoment: false,
      reason: "unclear_pattern",
      debugSummary: "Model used reserved false reason.",
    });
  });

  it("keeps parser failures as internal invalid_judge_json sentinels", () => {
    const judgment = parseWowJudgmentFromResponse(geminiEnvelope("not json"));

    expect(judgment).toMatchObject({
      isWowMoment: false,
      reason: "invalid_judge_json",
      parseFailureStage: "initial_non_json",
    });
  });
});
