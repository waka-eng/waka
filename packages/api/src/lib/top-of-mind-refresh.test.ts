import { describe, expect, it } from "vitest";

import {
  rankTopOfMindRefreshCandidates,
  type TopOfMindRefreshEvidenceInput,
  type TopOfMindRefreshNodeInput,
} from "./top-of-mind-refresh.js";

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
      title: "You may need a small real-world test, not another private theory.",
      ambientSignal: "You may need a small real-world test, not another private theory.",
      matchedEnvironment:
        "A practical setting where what kind of ambition still leaves room for life can be tested in public conditions.",
      reflectionQuestion: "what kind of ambition still leaves room for life?",
      wowScore: 100,
    });
    expect(candidates[0]?.why).toContain("Several signals ask whether ambition can stay humane.");
    expect(candidates[0]?.why).toContain("This may matter for ambition because it points at a next experiment frequency");
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

  it("generates ambition mirror statements instead of raw labels or shallow summaries", () => {
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
    expect(titles).toContain("You may need workrooms where making the thing is the default temperature.");
    expect(titles).toContain("You may be trying to leave rooms that reward consensus over aliveness.");
    for (const candidate of candidates) {
      expect(candidate.title).not.toBe(candidate.node.label);
      expect(candidate.title).not.toMatch(/^You keep circling\b/);
      expect(candidate.title).not.toMatch(/rooms where .+ can become normal/i);
      expect(candidate.title).not.toMatch(/work that turns .+ visible/i);
      expect(candidate.title).not.toMatch(/keep returning$/);
      expect(candidate.ambientSignal).toBe(candidate.title);
      expect(candidate.matchedEnvironment).toMatch(/environment|culture|work|setting|room/i);
      expect(candidate.antiEnvironment).toMatch(/settings|circles|contexts|rooms|loops|work/i);
      expect(candidate.evidenceRationale).toMatch(/saved signal/);
      expect(candidate.why).toContain("This may matter for ambition");
      expect(candidate.why).toContain("Ambient signal:");
      expect(candidate.why).toContain("Matched environment:");
      expect(candidate.why).toContain("Anti-environment:");
      expect(candidate.why).toContain("Evidence rationale:");
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
});
