import { describe, expect, it, vi } from "vitest";

import {
  createAmbitionSynthesisInput,
  runBoundedAmbitionSynthesisLoop,
  shouldRunAmbitionSynthesis,
  type AmbitionSynthesisOutput,
} from "./ambition-synthesis.js";
import {
  rankTopOfMindRefreshCandidates,
  type TopOfMindRefreshCandidate,
  type TopOfMindRefreshEvidenceInput,
  type TopOfMindRefreshNodeInput,
} from "./top-of-mind-refresh.js";

const userId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-05-30T12:00:00.000Z");

function node(
  input: Partial<TopOfMindRefreshNodeInput> &
    Pick<TopOfMindRefreshNodeInput, "id" | "type" | "label">,
): TopOfMindRefreshNodeInput {
  return {
    description: "Signals keep returning to places where ambition feels social.",
    weight: 160,
    confidence: 72,
    evidenceCount: 3,
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
    reason: "This signal supports the same ambition read.",
    weight: 90,
    createdAt: new Date("2026-05-30T10:00:00.000Z"),
    inspirationText:
      "A long saved signal about wanting to live near people who make building in public feel normal.",
    sparkText: "building in public feels normal here",
    sparkNote:
      'capture_metadata:v1:{"resonance":["want","envy"],"reflection":"I wanted this because the room made courage feel ordinary."}',
    ...input,
  };
}

function candidates(): TopOfMindRefreshCandidate[] {
  return rankTopOfMindRefreshCandidates({
    userId,
    now,
    nodes: [
      node({
        id: "public-building-room",
        type: "environment",
        label: "cities where public building is normal",
      }),
    ],
    evidence: [
      evidence({
        meaningNodeId: "public-building-room",
        inspirationId: "signal-1",
      }),
      evidence({
        meaningNodeId: "public-building-room",
        inspirationId: "signal-2",
        sparkText: "friends who make shipping less weird",
        createdAt: new Date("2026-05-29T10:00:00.000Z"),
      }),
    ],
  });
}

describe("bounded ambition synthesis", () => {
  it("builds bounded synthesis input from signals, highlights, metadata, feedback, rewrites, and competing reads", () => {
    const [candidate] = candidates();
    const input = createAmbitionSynthesisInput(candidate!, {
      userId,
      trigger: "correction",
      feedback: [
        {
          targetType: "context_node",
          targetId: "public-building-room",
          value: "partly",
          correctionText:
            "It is less about cities and more about peers who make brave work normal.",
          emotionLabel: "want",
          createdAt: new Date("2026-05-30T11:00:00.000Z"),
        },
      ],
    });

    expect(input.synthesisKey).toContain("ambition_synthesis:v1");
    expect(input.selectedSignals).toHaveLength(2);
    expect(input.selectedSignals[0]).toMatchObject({
      id: "signal-1",
      highlight: "building in public feels normal here",
      emotionalPullMetadata: ["want", "envy"],
      microReflection:
        "I wanted this because the room made courage feel ordinary.",
    });
    expect(input.priorFeedback).toHaveLength(1);
    expect(input.rewrites).toEqual([
      "It is less about cities and more about peers who make brave work normal.",
    ]);
    expect(input.rejectedOrCompetingInterpretations[0]).toContain(
      "It is less about cities",
    );
    expect(input.estimatedTokens).toBeLessThanOrEqual(input.tokenBudget);
  });

  it("only runs on explicit triggers and qualified bounded evidence sets", () => {
    const [candidate] = candidates();

    expect(
      shouldRunAmbitionSynthesis({
        candidate: candidate!,
        trigger: "weekly_refresh",
      }),
    ).toBe(true);

    const thinCandidate = {
      ...candidate!,
      evidence: [candidate!.evidence[0]!],
      node: { ...candidate!.node, evidenceCount: 1 },
    };
    expect(
      shouldRunAmbitionSynthesis({
        candidate: thinCandidate,
        trigger: "weekly_refresh",
      }),
    ).toBe(false);
    expect(
      shouldRunAmbitionSynthesis({
        candidate: thinCandidate,
        trigger: "explicit_deep_dive",
      }),
    ).toBe(true);
  });

  it("uses mocked provider synthesis when it states the user's personal edge", async () => {
    const output: AmbitionSynthesisOutput = {
      firstPersonPostItCandidate: "people who make courage feel normal",
      memoryState: "active",
      environmentDirection:
        "People and rooms where shipping in public feels like the expected rhythm.",
      rejectedEnvironment:
        "Rooms that turn courage into private planning or generic startup theater.",
      evidenceRationale:
        "Two saved signals and one correction point toward peers as the personal edge, not cities as a category.",
      confidence: 88,
      rejectedAlternativeInterpretation:
        "The shallow read would call this cities, but the user's edge is wanting peers who normalize visible work.",
    };
    const synthesize = vi.fn().mockResolvedValue(output);

    const result = await runBoundedAmbitionSynthesisLoop({
      userId,
      trigger: "weekly_refresh",
      candidates: candidates(),
      synthesize,
    });

    expect(result).toMatchObject({
      attempted: 1,
      synthesized: 1,
      fellBack: 0,
      skipped: 0,
    });
    expect(result.candidates[0]).toMatchObject({
      title: "people who make courage feel normal",
      matchedEnvironment:
        "People and rooms where shipping in public feels like the expected rhythm.",
      rejectedAlternativeInterpretation:
        "The shallow read would call this cities, but the user's edge is wanting peers who normalize visible work.",
      wowScore: 88,
    });
    expect(result.candidates[0]?.why).toContain(
      "Rejected alternative interpretation:",
    );
  });

  it("falls back deterministically when synthesis is unavailable or generic", async () => {
    const generic: AmbitionSynthesisOutput = {
      firstPersonPostItCandidate: "I want startups.",
      memoryState: "active",
      environmentDirection: "Startups.",
      rejectedEnvironment: "No startups.",
      evidenceRationale: "The category appeared.",
      confidence: 90,
      rejectedAlternativeInterpretation:
        "The shallow read would call this startups.",
    };

    const result = await runBoundedAmbitionSynthesisLoop({
      userId,
      trigger: "weekly_refresh",
      candidates: candidates(),
      synthesize: vi.fn().mockResolvedValue(generic),
    });

    expect(result).toMatchObject({
      attempted: 1,
      synthesized: 0,
      fellBack: 1,
    });
    expect(result.candidates[0]?.title).toBe(
      "a room where unfinished ambition is allowed",
    );
    expect(result.candidates[0]?.rejectedAlternativeInterpretation).toContain(
      "shallow read",
    );
  });

  it("caps model-heavy synthesis attempts even when more candidates are ranked", async () => {
    const manyCandidates = [
      ...candidates(),
      ...candidates().map((candidate) => ({
        ...candidate,
        node: { ...candidate.node, id: "second-node", label: "second" },
        idempotencyKey: `${candidate.idempotencyKey}:second`,
      })),
      ...candidates().map((candidate) => ({
        ...candidate,
        node: { ...candidate.node, id: "third-node", label: "third" },
        idempotencyKey: `${candidate.idempotencyKey}:third`,
      })),
      ...candidates().map((candidate) => ({
        ...candidate,
        node: { ...candidate.node, id: "fourth-node", label: "fourth" },
        idempotencyKey: `${candidate.idempotencyKey}:fourth`,
      })),
    ];
    const synthesize = vi.fn().mockResolvedValue(null);

    const result = await runBoundedAmbitionSynthesisLoop({
      userId,
      trigger: "weekly_refresh",
      candidates: manyCandidates,
      synthesize,
    });

    expect(result.attempted).toBe(3);
    expect(result.fellBack).toBe(3);
    expect(result.skipped).toBe(1);
    expect(synthesize).toHaveBeenCalledTimes(3);
  });
});
