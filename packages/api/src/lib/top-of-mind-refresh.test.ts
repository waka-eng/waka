import { describe, expect, it, vi } from "vitest";

import {
  rankTopOfMindRefreshCandidates,
  refreshTopOfMindNotesFromContextGraph,
  type TopOfMindRefreshEvidenceInput,
  type TopOfMindRefreshNodeInput,
} from "./top-of-mind-refresh.js";
import type { TopOfMindNoteGenerationInput } from "./model-provider.js";

const userId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-05-30T12:00:00.000Z");

function node(
  input: Partial<TopOfMindRefreshNodeInput> & Pick<TopOfMindRefreshNodeInput, "id" | "type" | "label">,
): TopOfMindRefreshNodeInput {
  return {
    description: "",
    weight: 100,
    confidence: 50,
    evidenceCount: 2,
    firstSeenAt: new Date("2026-05-01T10:00:00.000Z"),
    lastReinforcedAt: new Date("2026-05-30T10:00:00.000Z"),
    ...input,
  };
}

function evidence(
  input: Partial<TopOfMindRefreshEvidenceInput> &
    Pick<TopOfMindRefreshEvidenceInput, "meaningNodeId" | "inspirationId">,
): TopOfMindRefreshEvidenceInput {
  return {
    reason: "This signal supports the provisional note.",
    weight: 70,
    createdAt: new Date("2026-05-30T10:00:00.000Z"),
    inspirationText: "A source signal about work that makes the surrounding life better.",
    sparkText: "life around the work",
    ...input,
  };
}

class QueryStub<T> implements PromiseLike<T> {
  constructor(private readonly result: T) {}
  from() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
    return this;
  }
  limit() {
    return this;
  }
  innerJoin() {
    return this;
  }
  leftJoin() {
    return this;
  }
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function refreshDbStub(preferredLocale = "en-US") {
  const insertedWowMoments: unknown[] = [];
  const insertedEvidenceLinks: unknown[] = [];
  const selectResults = [
    [{ preferredLocale }],
    [
      node({
        id: "public-building-room",
        type: "environment",
        label: "cities where public building is normal",
        description: "Signals keep returning to places where ambition feels social.",
        weight: 160,
        confidence: 72,
        evidenceCount: 2,
      }),
    ],
    [
      evidence({ meaningNodeId: "public-building-room", inspirationId: "signal-1" }),
      evidence({
        meaningNodeId: "public-building-room",
        inspirationId: "signal-2",
        sparkText: "friends who make shipping less weird",
      }),
    ],
    [],
    [],
  ];
  let selectIndex = 0;
  return {
    insertedWowMoments,
    insertedEvidenceLinks,
    db: {
      select: vi.fn(() => new QueryStub(selectResults[selectIndex++] ?? [])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn(() => ({
            values(value: unknown) {
              const target = Array.isArray(value) ? insertedEvidenceLinks : insertedWowMoments;
              target.push(value);
              return {
                onConflictDoNothing() {
                  return {
                    returning() {
                      return new QueryStub([{ id: "moment-1" }]);
                    },
                    then<TResult1 = unknown, TResult2 = never>(
                      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
                      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
                    ): PromiseLike<TResult1 | TResult2> {
                      return Promise.resolve(undefined).then(onfulfilled, onrejected);
                    },
                  };
                },
              };
            },
          })),
          select: vi.fn(() => new QueryStub([{ id: "existing-moment" }])),
        };
        return callback(tx);
      }),
    },
  };
}

describe("rankTopOfMindRefreshCandidates", () => {
  it("prioritizes unresolved and high-agency context over generic themes", () => {
    const candidates = rankTopOfMindRefreshCandidates({
      userId,
      now,
      nodes: [
        node({
          id: "theme-node",
          type: "theme",
          label: "generic taste in studio spaces",
          weight: 60,
          evidenceCount: 2,
        }),
        node({
          id: "project-node",
          type: "project",
          label: "build a quieter research room",
          weight: 180,
          evidenceCount: 2,
        }),
        node({
          id: "tension-node",
          type: "tension",
          label: "wanting solitude and wanting collaborators",
          weight: 160,
          evidenceCount: 2,
        }),
      ],
      evidence: [
        evidence({ meaningNodeId: "theme-node", inspirationId: "signal-theme" }),
        evidence({ meaningNodeId: "project-node", inspirationId: "signal-project" }),
        evidence({ meaningNodeId: "tension-node", inspirationId: "signal-tension" }),
      ],
    });

    expect(candidates.map((candidate) => candidate.node.id)).toEqual([
      "project-node",
      "tension-node",
      "theme-node",
    ]);
    expect(candidates[0]).toMatchObject({
      contextType: "project",
      ambitionDimension: "work",
      kind: "bridge",
      reflectionGuide: expect.stringContaining("Start here"),
    });
    expect(candidates[1]).toMatchObject({
      contextType: "tension",
      ambitionDimension: "rejection",
      kind: "tension",
      reflectionQuestion: "What correction would make this feel truer right now?",
    });
  });

  it("uses recurrence, recent evidence, and evidence weight to shape note payloads", () => {
    const candidates = rankTopOfMindRefreshCandidates({
      userId,
      now,
      nodes: [
        node({
          id: "recurring-question",
          type: "open_question",
          label: "what kind of ambition still leaves room for life",
          description: "Several signals ask whether ambition can stay humane.",
          weight: 220,
          confidence: 72,
          evidenceCount: 4,
          lastReinforcedAt: new Date("2026-05-30T09:00:00.000Z"),
        }),
      ],
      evidence: [
        evidence({
          meaningNodeId: "recurring-question",
          inspirationId: "signal-old",
          weight: 50,
          createdAt: new Date("2026-05-01T10:00:00.000Z"),
          sparkText: "older proof",
        }),
        evidence({
          meaningNodeId: "recurring-question",
          inspirationId: "signal-strong",
          weight: 90,
          createdAt: new Date("2026-05-30T09:00:00.000Z"),
          sparkText: "humane ambition",
        }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      contextType: "open_question",
      ambitionDimension: "next_experiment",
      kind: "outlier",
      title: "",
      ambientSignal: "",
      matchedEnvironment:
        "A practical setting where what kind of ambition still leaves room for life can be tested in public conditions.",
      reflectionQuestion: "what kind of ambition still leaves room for life?",
      wowScore: 100,
    });
    expect(candidates[0]?.why).toBe("");
    expect(candidates[0]?.why).not.toContain("This may matter for ambition");
    expect(candidates[0]?.why).not.toContain("Memory movement:");
    expect(candidates[0]?.memoryPattern).toMatchObject({
      state: "active",
      reinforcementCount: 4,
      recentReinforcementCount: 2,
      supportingSignalIds: ["signal-strong", "signal-old"],
    });
    expect(candidates[0]?.evidence.map((row) => row.inspirationId)).toEqual([
      "signal-strong",
      "signal-old",
    ]);
  });

  it("does not duplicate an existing active note for the same graph claim", () => {
    const existingKey = `${"top_of_mind_context_node:v1"}:${userId}:already-noted`;
    const candidates = rankTopOfMindRefreshCandidates({
      userId,
      now,
      existingIdempotencyKeys: new Set([existingKey]),
      nodes: [
        node({
          id: "already-noted",
          type: "value",
          label: "honest rooms",
          evidenceCount: 5,
        }),
        node({
          id: "fresh-node",
          type: "value",
          label: "less performative ambition",
          evidenceCount: 3,
        }),
      ],
      evidence: [
        evidence({ meaningNodeId: "already-noted", inspirationId: "signal-a" }),
        evidence({ meaningNodeId: "fresh-node", inspirationId: "signal-b" }),
      ],
    });

    expect(candidates.map((candidate) => candidate.node.id)).toEqual([
      "fresh-node",
    ]);
    expect(candidates[0]?.idempotencyKey).toBe(
      `top_of_mind_context_node:v1:${userId}:fresh-node`,
    );
  });

  it("ranks candidates without generating fallback post-it statements", () => {
    const candidates = rankTopOfMindRefreshCandidates({
      userId,
      now,
      nodes: [
        node({
          id: "founder-cities",
          type: "theme",
          label: "founder cities",
          description: "Saved signals point toward public building environments.",
          evidenceCount: 3,
        }),
        node({
          id: "consensus-tension",
          type: "tension",
          label: "consensus over aliveness",
          description: "The user reacts against rooms that reward smoothing over truth.",
          evidenceCount: 3,
        }),
      ],
      evidence: [
        evidence({
          meaningNodeId: "founder-cities",
          inspirationId: "signal-city-1",
          sparkText: "people making things in public",
        }),
        evidence({
          meaningNodeId: "founder-cities",
          inspirationId: "signal-city-2",
          sparkText: "rooms where ambition is contagious",
          weight: 80,
        }),
        evidence({
          meaningNodeId: "consensus-tension",
          inspirationId: "signal-rejection-1",
          sparkText: "leaving consensus rooms",
        }),
      ],
    });

    const titles = candidates.map((candidate) => candidate.title);
    expect(titles).toEqual(["", ""]);
    for (const candidate of candidates) {
      expect(candidate.title).toBe("");
      expect(candidate.title).not.toMatch(/^(You|Your|This person|WAKA)\b/i);
      expect(candidate.ambientSignal).not.toMatch(/^(You|Your|This person|WAKA)\b/i);
      expect(candidate.title).not.toMatch(/^(I need|I want|I am|I'm|I refuse|I am done with)\b/i);
      expect(candidate.ambientSignal).not.toMatch(/^(I need|I want|I am|I'm|I refuse|I am done with)\b/i);
      expect(candidate.title).not.toMatch(/\b(I think|maybe|might|probably|seems)\b/i);
      expect(candidate.ambientSignal).not.toMatch(/\b(I think|maybe|might|probably|seems)\b/i);
      expect(candidate.title).not.toMatch(
        /^(public before perfect|taste as default|test it outside|test it in public|courage normal)$/i,
      );
      expect(candidate.title).not.toMatch(/^You keep circling\b/);
      expect(candidate.title).not.toMatch(/rooms where .+ can become normal/i);
      expect(candidate.title).not.toMatch(/work that turns .+ visible/i);
      expect(candidate.title).not.toMatch(/keep returning$/);
      expect(candidate.ambientSignal).toBe("");
      expect(candidate.matchedEnvironment).toMatch(/environment|culture|work|setting|room/i);
      expect(candidate.antiEnvironment).toMatch(/settings|circles|contexts|rooms|loops|work/i);
      expect(candidate.evidenceRationale).toMatch(/saved signal/);
      expect(candidate.why).toBe("");
      expect(candidate.why).not.toContain("This may matter for ambition");
      expect(candidate.why).not.toContain("Ambient signal:");
      expect(candidate.why).not.toContain("Matched environment:");
      expect(candidate.why).not.toContain("Anti-environment:");
      expect(candidate.why).not.toContain("Evidence rationale:");
      expect(candidate.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("skips graph claims without supporting evidence", () => {
    const candidates = rankTopOfMindRefreshCandidates({
      userId,
      now,
      nodes: [
        node({
          id: "unsupported",
          type: "hypothesis",
          label: "a plausible but unsupported claim",
          evidenceCount: 3,
        }),
      ],
      evidence: [],
    });

    expect(candidates).toEqual([]);
  });

  it("prioritizes meaningful memory movement over static highest-weight nodes", () => {
    const candidates = rankTopOfMindRefreshCandidates({
      userId,
      now,
      nodes: [
        node({
          id: "static-active",
          type: "theme",
          label: "generic productivity systems",
          weight: 260,
          confidence: 75,
          evidenceCount: 5,
          firstSeenAt: new Date("2026-04-01T10:00:00.000Z"),
          lastReinforcedAt: new Date("2026-05-25T10:00:00.000Z"),
        }),
        node({
          id: "returned-after-dormancy",
          type: "environment",
          label: "rooms where brave public building is normal",
          weight: 120,
          confidence: 68,
          evidenceCount: 3,
          firstSeenAt: new Date("2025-10-01T10:00:00.000Z"),
          lastReinforcedAt: new Date("2026-05-30T10:00:00.000Z"),
        }),
      ],
      evidence: [
        evidence({
          meaningNodeId: "static-active",
          inspirationId: "signal-static",
          createdAt: new Date("2026-05-25T10:00:00.000Z"),
        }),
        evidence({
          meaningNodeId: "returned-after-dormancy",
          inspirationId: "signal-return",
          createdAt: new Date("2026-05-30T10:00:00.000Z"),
          sparkText: "this came back after months away",
        }),
        evidence({
          meaningNodeId: "returned-after-dormancy",
          inspirationId: "signal-old",
          createdAt: new Date("2026-02-01T10:00:00.000Z"),
          sparkText: "an older version of this same pull",
        }),
      ],
    });

    expect(candidates[0]?.node.id).toBe("returned-after-dormancy");
    expect(candidates[0]?.memoryPattern.state).toBe("reactivated");
    expect(candidates[0]?.memoryPattern.currentWeight).toBeLessThan(
      candidates[1]?.memoryPattern.currentWeight ?? 0,
    );
  });
});

describe("refreshTopOfMindNotesFromContextGraph", () => {
  it("does not insert wow moments when synthesis fails and exposes failure metadata", async () => {
    const { db, insertedWowMoments } = refreshDbStub();
    const result = await refreshTopOfMindNotesFromContextGraph(db as never, {
      userId,
      now,
      modelProvider: {
        generateTopOfMindNotes: async (input: TopOfMindNoteGenerationInput) =>
          rankTopOfMindRefreshCandidates(input),
        synthesizeAmbition: vi.fn().mockResolvedValue(null),
      } as never,
    });

    expect(result.generated).toBe(0);
    expect(result.notes).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.synthesis).toMatchObject({
      attempted: 1,
      synthesized: 0,
      failed: 1,
      skipped: 0,
    });
    expect(result.synthesis.failures[0]).toMatchObject({
      contextNodeId: "public-building-room",
      reason: "null_output",
    });
    expect(insertedWowMoments).toEqual([]);
  });

  it("persists successfully synthesized refresh candidates", async () => {
    const { db, insertedWowMoments } = refreshDbStub();
    const result = await refreshTopOfMindNotesFromContextGraph(db as never, {
      userId,
      now,
      modelProvider: {
        generateTopOfMindNotes: async (input: TopOfMindNoteGenerationInput) =>
          rankTopOfMindRefreshCandidates(input),
        synthesizeAmbition: vi.fn().mockResolvedValue({
          firstPersonPostItCandidate: "people who make courage feel normal",
          memoryState: "active",
          environmentDirection:
            "People and rooms where shipping in public feels like the expected rhythm.",
          rejectedEnvironment:
            "Rooms that turn courage into private planning or generic startup theater.",
          evidenceRationale:
            "Two saved signals point toward peers as the personal edge, not cities as a category.",
          confidence: 88,
          rejectedAlternativeInterpretation:
            "The shallow read would call this cities, but the user's edge is wanting peers who normalize visible work.",
        }),
      } as never,
    });

    expect(result.generated).toBe(1);
    expect(result.notes).toEqual([
      { id: "moment-1", contextNodeId: "public-building-room", status: "created" },
    ]);
    expect(result.synthesis).toMatchObject({
      attempted: 1,
      synthesized: 1,
      failed: 0,
      skipped: 0,
    });
    expect(insertedWowMoments[0]).toMatchObject({
      title: "people who make courage feel normal",
      beliefStatement: "people who make courage feel normal",
      locale: "en-US",
      wowScore: 88,
    });
  });

  it("propagates ko-KR into generation, synthesis, and persisted active notes", async () => {
    const { db, insertedWowMoments } = refreshDbStub("ko-KR");
    const generateTopOfMindNotes = vi.fn(async (input: TopOfMindNoteGenerationInput) =>
      rankTopOfMindRefreshCandidates(input),
    );
    const synthesizeAmbition = vi.fn().mockResolvedValue({
      firstPersonPostItCandidate: "용기가 평범해지는 사람들 곁에서 일을 만들기",
      memoryState: "active",
      environmentDirection:
        "공개적으로 만들고 내보내는 일이 자연스럽게 여겨지는 사람들과 방이 이 야망을 지지한다.",
      rejectedEnvironment:
        "허락과 포장을 먼저 요구하며 움직임을 사적인 계획으로만 남기는 방은 이 감각을 약하게 만든다.",
      evidenceRationale:
        "저장된 두 신호는 도시라는 범주보다 보이는 일을 평범하게 만드는 동료를 향한다.",
      confidence: 88,
      rejectedAlternativeInterpretation:
        "얕은 해석은 도시 취향이지만 더 정확한 해석은 용기를 보통으로 만드는 사람들에 대한 끌림이다.",
    });

    const result = await refreshTopOfMindNotesFromContextGraph(db as never, {
      userId,
      now,
      modelProvider: {
        generateTopOfMindNotes,
        synthesizeAmbition,
      } as never,
    });

    expect(result.generated).toBe(1);
    expect(generateTopOfMindNotes).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLocale: "ko-KR" }),
    );
    expect(synthesizeAmbition).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLocale: "ko-KR" }),
    );
    expect(insertedWowMoments[0]).toMatchObject({
      title: "용기가 평범해지는 사람들 곁에서 일을 만들기",
      beliefStatement: "용기가 평범해지는 사람들 곁에서 일을 만들기",
      reflectionQuestion: null,
      reflectionGuide: null,
      locale: "ko-KR",
      wowScore: 88,
    });
  });
});
