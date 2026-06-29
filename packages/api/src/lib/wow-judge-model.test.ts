import { describe, expect, it } from "vitest";

import {
  buildKoreanBeliefStatementRepairRequest,
  buildWowGenerateContentUrl,
  buildWowJudgmentRequest,
  buildWowRepairJudgmentRequest,
  GeminiWowJudgeClient,
  GeminiWowJudgeValidationError,
  parseWowJudgmentFromResponse,
  validatePersistedWowSourceEvidence,
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

function geminiEnvelope(text: string, finishReason = "STOP") {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason,
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
      otherCandidateId,
    ]);
  });

  it("keeps Gemini JSON mode and excludes invalid_judge_json from model false reasons", () => {
    const request = buildWowJudgmentRequest(sampleInput);
    const schema = request.generationConfig.responseSchema as {
      anyOf: Array<{ properties: { reason?: { enum?: string[] } } }>;
    };

    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(3072);
    expect(schema.anyOf[0]?.properties.reason?.enum).toEqual([
      "not_enough_candidates",
      "generic_similarity",
      "weak_relationship",
      "duplicate_or_rephrasing",
      "insufficient_surprise",
      "unclear_pattern",
    ]);
  });

  it("keeps repair output bounded but large enough for compact Korean true JSON", () => {
    const request = buildWowRepairJudgmentRequest("not json", {
      ...sampleInput,
      locale: "ko-KR",
    });
    const payload = JSON.parse(request.contents[0]?.parts[0]?.text ?? "{}");

    expect(request.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(1024);
    expect(request.generationConfig.maxOutputTokens).toBeLessThanOrEqual(1536);
    expect(payload.outputContract.trueShape.limits.reflectionGuide).toContain(
      "800 characters or fewer",
    );
  });

  it("rejects non-product source evidence at the persistence preflight boundary", () => {
    expect(() =>
      validatePersistedWowSourceEvidence(
        [
          {
            inspirationId: triggerId,
            role: "runtimeCandidateScore",
            reason: "This internal score label would otherwise become fallback text.",
          },
          {
            inspirationId: candidateId,
            role: "The related signal",
            reason: "This source gives the second grounded user-facing signal.",
          },
        ],
        [triggerId, candidateId],
      ),
    ).toThrow(GeminiWowJudgeValidationError);
  });

  it("repair prompts reuse the same contract, min-source floor, and fallback false object", () => {
    const request = buildWowRepairJudgmentRequest("not json", sampleInput);
    const requestText = JSON.stringify(request);
    const payload = JSON.parse(request.contents[0]?.parts[0]?.text ?? "{}");

    expect(requestText).toContain("has fewer than 3 unique allowed signals");
    expect(requestText).not.toContain("has fewer than 2 unique allowed signals");
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
          relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
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
            {
              inspirationId: otherCandidateId,
              role: "The outside test",
              reason: "Adds taste getting sharper outside private drafts.",
            },
          ],
        }),
      ),
    );
    expect(trueJudgment).toMatchObject({
      isWowMoment: true,
      kind: "bridge",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
    });
  });

  it("accepts soft aphoristic belief fragments from live WOW judge output", () => {
    for (const beliefStatement of [
      "letting go is not weakness but the prerequisite for new growth",
      "build the future through the quiet architecture of daily choices",
      "city repair starts through small visible acts of care",
      "neighbors make civic repair feel possible when care is visible",
    ]) {
      const judgment = parseWowJudgmentFromResponse(
        geminiEnvelope(
          JSON.stringify({
            isWowMoment: true,
            kind: "bridge",
            title: "Quiet Growth",
            why: "Two signals connect release with deliberate future-building.",
            beliefStatement,
            relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
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
              {
                inspirationId: otherCandidateId,
                role: "The outside test",
                reason: "Adds taste getting sharper outside private drafts.",
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

  it("does not finalize Korean MAX_TOKENS true prefixes without grounded source evidence", async () => {
    const koreanInput: WowJudgeInput = {
      ...sampleInput,
      locale: "ko-KR",
      trigger: {
        ...sampleInput.trigger,
        text: "인연의 자연스러운 흐름 안에서 비움과 채움이 함께 움직이는 느낌이 든다.",
      },
      candidates: [
        {
          ...sampleInput.candidates[0]!,
          text: "무언가를 억지로 붙잡지 않을 때 새로운 만남과 가능성이 자연스럽게 들어온다.",
        },
        sampleInput.candidates[1]!,
      ],
    };
    const truncatedKoreanTruePrefix = `{"isWowMoment":true,"kind":"bridge","title":"비움과 채움의 자연스러운 리듬","why":"두 신호는 붙잡기보다 흐름을 신뢰할 때 새로운 가능성이 들어오는 감각을 함께 보여줍니다.","beliefStatement":"비움과 채움이 자연스럽게 이어질 수 있습니다","reflectionQuestion":"지금 무엇을 조금 덜 붙잡아도 괜찮을까요?","reflectionGuide":"여기서 시작해 보세요\\n이 신호들이 말하는 흐름의 감각을 천천히 살펴보세요.`;
    const responses = [
      geminiEnvelope(truncatedKoreanTruePrefix, "MAX_TOKENS"),
      geminiEnvelope("not json", "MAX_TOKENS"),
    ];
    const client = new GeminiWowJudgeClient({
      apiKey: "test-key",
      fetchFn: async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.judgeWowMoment(koreanInput)).resolves.toEqual({
      isWowMoment: false,
      reason: "unclear_pattern",
      debugSummary: "Could not safely finalize truncated top-of-mind judge output.",
    });
    expect(responses).toHaveLength(0);
  });

  it("finalizes Korean MAX_TOKENS true prefixes only with complete grounded source evidence", async () => {
    const koreanInput: WowJudgeInput = {
      ...sampleInput,
      locale: "ko-KR",
      trigger: {
        ...sampleInput.trigger,
        text: "인연의 자연스러운 흐름 안에서 비움과 채움이 함께 움직이는 느낌이 든다.",
      },
      candidates: [
        {
          ...sampleInput.candidates[0]!,
          text: "무언가를 억지로 붙잡지 않을 때 새로운 만남과 가능성이 자연스럽게 들어온다.",
        },
        sampleInput.candidates[1]!,
      ],
    };
    const groundedKoreanTruePrefix = JSON.stringify({
      isWowMoment: true,
      kind: "bridge",
      title: "비움과 채움의 자연스러운 리듬",
      why: "두 신호는 붙잡기보다 흐름을 신뢰할 때 새로운 가능성이 들어오는 감각을 함께 보여줍니다.",
      beliefStatement: "비움과 채움이 자연스럽게 이어질 수 있습니다",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
      sourceEvidence: [
        {
          inspirationId: triggerId,
          role: "흐름을 느낀 순간",
          reason: "비움과 채움이 함께 움직인다는 감각을 직접 드러냅니다.",
        },
        {
          inspirationId: candidateId,
          role: "덜 붙잡는 가능성",
          reason: "억지로 붙잡지 않을 때 새로운 만남이 들어온다는 신호를 보탭니다.",
        },
        {
          inspirationId: otherCandidateId,
          role: "다른 시험의 감각",
          reason: "사적인 초안 밖에서 감각을 시험하는 신호를 보탭니다.",
        },
      ],
    }).replace(/}$/, ',"reflectionGuide":"여기서 시작해 보세요\\n이 흐름의 감각을 천천히 살펴보세요.');
    const responses = [
      geminiEnvelope(groundedKoreanTruePrefix, "MAX_TOKENS"),
      geminiEnvelope("not json", "MAX_TOKENS"),
    ];
    const client = new GeminiWowJudgeClient({
      apiKey: "test-key",
      fetchFn: async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.judgeWowMoment(koreanInput)).resolves.toMatchObject({
      isWowMoment: true,
      kind: "bridge",
      title: "비움과 채움의 자연스러운 리듬",
      beliefStatement: "비움과 채움이 자연스럽게 이어질 수 있습니다",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
      sourceEvidence: [
        {
          inspirationId: triggerId,
          role: "흐름을 느낀 순간",
          reason: "비움과 채움이 함께 움직인다는 감각을 직접 드러냅니다.",
        },
        {
          inspirationId: candidateId,
          role: "덜 붙잡는 가능성",
          reason: "억지로 붙잡지 않을 때 새로운 만남이 들어온다는 신호를 보탭니다.",
        },
        {
          inspirationId: otherCandidateId,
          role: "다른 시험의 감각",
          reason: "사적인 초안 밖에서 감각을 시험하는 신호를 보탭니다.",
        },
      ],
    });
    expect(responses).toHaveLength(1);
  });

  it("builds a bounded Korean beliefStatement-only repair request", () => {
    const request = buildKoreanBeliefStatementRepairRequest("{bad belief}", {
      ...sampleInput,
      locale: "ko-KR",
    });
    const payload = JSON.parse(request.contents[0]?.parts[0]?.text ?? "{}");

    expect(request.generationConfig.maxOutputTokens).toBeLessThanOrEqual(512);
    expect(request.systemInstruction.parts[0]?.text).toContain(
      "Rewrite only the beliefStatement",
    );
    expect(payload.repairTask).toContain("Return only a JSON object");
    expect(payload.rawPriorOutput).toBe("{bad belief}");
  });

  it("repairs only Korean beliefStatement phrasing while preserving grounded fields", async () => {
    const koreanInput: WowJudgeInput = {
      ...sampleInput,
      locale: "ko-KR",
      trigger: {
        ...sampleInput.trigger,
        text: "관계가 억지로 닫히기보다 자연스럽게 이어질 때 마음이 열린다.",
      },
      candidates: [
        {
          ...sampleInput.candidates[0]!,
          text: "붙잡지 않을 때 새로운 인연과 가능성이 들어올 공간이 생긴다.",
        },
        sampleInput.candidates[1]!,
      ],
    };
    const hardBeliefPayload = JSON.stringify({
      isWowMoment: true,
      kind: "bridge",
      title: "관계가 자연스럽게 이어지는 흐름",
      why: "두 신호는 억지로 붙잡기보다 관계와 가능성이 들어올 공간을 남기는 감각을 함께 보여줍니다.",
      beliefStatement: "당신은 반드시 관계를 자연스럽게 이어가는 사람입니다",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
      sourceEvidence: [
        {
          inspirationId: triggerId,
          role: "열린 관계의 감각",
          reason: "관계가 억지로 닫히지 않을 때 마음이 열린다는 신호를 담습니다.",
        },
        {
          inspirationId: candidateId,
          role: "붙잡지 않는 공간",
          reason: "덜 붙잡을 때 새로운 가능성이 들어온다는 흐름을 보탭니다.",
        },
        {
          inspirationId: otherCandidateId,
          role: "다른 시험의 감각",
          reason: "사적인 초안 밖에서 감각을 시험하는 신호를 보탭니다.",
        },
      ],
    });
    const responses = [
      geminiEnvelope(hardBeliefPayload),
      geminiEnvelope(
        JSON.stringify({
          beliefStatement: "관계가 자연스럽게 이어질 수 있습니다",
        }),
      ),
    ];
    const client = new GeminiWowJudgeClient({
      apiKey: "test-key",
      fetchFn: async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.judgeWowMoment(koreanInput)).resolves.toEqual({
      isWowMoment: true,
      kind: "bridge",
      title: "관계가 자연스럽게 이어지는 흐름",
      why: "두 신호는 억지로 붙잡기보다 관계와 가능성이 들어올 공간을 남기는 감각을 함께 보여줍니다.",
      beliefStatement: "관계가 자연스럽게 이어질 수 있습니다",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
      sourceEvidence: [
        {
          inspirationId: triggerId,
          role: "열린 관계의 감각",
          reason: "관계가 억지로 닫히지 않을 때 마음이 열린다는 신호를 담습니다.",
        },
        {
          inspirationId: candidateId,
          role: "붙잡지 않는 공간",
          reason: "덜 붙잡을 때 새로운 가능성이 들어온다는 흐름을 보탭니다.",
        },
        {
          inspirationId: otherCandidateId,
          role: "다른 시험의 감각",
          reason: "사적인 초안 밖에서 감각을 시험하는 신호를 보탭니다.",
        },
      ],
    });
    expect(responses).toHaveLength(0);
  });

  it("fails closed when Korean belief-only repair cannot produce soft Hangul phrasing", async () => {
    const hardBeliefPayload = JSON.stringify({
      isWowMoment: true,
      kind: "bridge",
      title: "관계가 자연스럽게 이어지는 흐름",
      why: "두 신호는 관계와 가능성이 들어올 공간을 남기는 감각을 함께 보여줍니다.",
      beliefStatement: "당신은 반드시 관계를 자연스럽게 이어가는 사람입니다",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
      sourceEvidence: [
        {
          inspirationId: triggerId,
          role: "열린 관계의 감각",
          reason: "관계가 억지로 닫히지 않을 때 마음이 열린다는 신호를 담습니다.",
        },
        {
          inspirationId: candidateId,
          role: "붙잡지 않는 공간",
          reason: "덜 붙잡을 때 새로운 가능성이 들어온다는 흐름을 보탭니다.",
        },
        {
          inspirationId: otherCandidateId,
          role: "다른 시험의 감각",
          reason: "사적인 초안 밖에서 감각을 시험하는 신호를 보탭니다.",
        },
      ],
    });
    const responses = [
      geminiEnvelope(hardBeliefPayload),
      geminiEnvelope(
        JSON.stringify({
          beliefStatement: "당신은 반드시 관계를 자연스럽게 이어가는 사람입니다",
        }),
      ),
    ];
    const client = new GeminiWowJudgeClient({
      apiKey: "test-key",
      fetchFn: async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(
      client.judgeWowMoment({ ...sampleInput, locale: "ko-KR" }),
    ).resolves.toEqual({
      isWowMoment: false,
      reason: "unclear_pattern",
      debugSummary:
        "Gemini returned an over-presumptive sticky-note belief statement.",
    });
  });

  it("keeps non-Korean unrepaired hard belief wording as a non-defect false reason", async () => {
    const hardBeliefPayload = JSON.stringify({
      isWowMoment: true,
      kind: "bridge",
      title: "Civic repair through visible care",
      why: "The signals connect civic maintenance with neighbors making repair feel possible.",
      beliefStatement: "I need civic repair to become visible neighbor care",
      relatedInspirationIds: [triggerId, candidateId, otherCandidateId],
      sourceEvidence: [
        {
          inspirationId: triggerId,
          role: "The civic pull",
          reason: "Names the desire for local repair to feel tangible.",
        },
        {
          inspirationId: candidateId,
          role: "The visible practice",
          reason: "Connects public maintenance with neighbors seeing possibility.",
        },
        {
          inspirationId: otherCandidateId,
          role: "The outside test",
          reason: "Adds taste getting sharper outside private drafts.",
        },
      ],
    });
    const responses = [geminiEnvelope(hardBeliefPayload), geminiEnvelope(hardBeliefPayload)];
    const client = new GeminiWowJudgeClient({
      apiKey: "test-key",
      fetchFn: async () =>
        new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.judgeWowMoment(sampleInput)).resolves.toEqual({
      isWowMoment: false,
      reason: "unclear_pattern",
      debugSummary:
        "Gemini returned an over-presumptive sticky-note belief statement.",
    });
  });
});
