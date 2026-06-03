import { describe, expect, it } from "vitest";

import {
  assembleWhatToBuildDecisionMemo,
  type DecisionMemoContextNodeInput,
  type DecisionMemoEvidenceInput,
} from "./decision-memo.js";

const now = new Date("2026-05-30T12:00:00.000Z");

function node(
  input: Partial<DecisionMemoContextNodeInput> &
    Pick<DecisionMemoContextNodeInput, "id" | "type" | "label">,
): DecisionMemoContextNodeInput {
  return {
    description: "",
    weight: 80,
    confidence: 60,
    evidenceCount: 2,
    lastReinforcedAt: new Date("2026-05-30T10:00:00.000Z"),
    ...input,
  };
}

function evidence(
  input: Partial<DecisionMemoEvidenceInput> &
    Pick<DecisionMemoEvidenceInput, "contextNodeId" | "signalId">,
): DecisionMemoEvidenceInput {
  return {
    reason: "This signal supports the build direction.",
    weight: 70,
    confidence: 70,
    createdAt: new Date("2026-05-30T09:00:00.000Z"),
    signalText: "A signal about building tools that make ambition feel livable.",
    signalKind: "note",
    resonanceScore: 72,
    packetText: "WHAT_HIT: ambition that leaves room for daily life",
    ...input,
  };
}

describe("assembleWhatToBuildDecisionMemo", () => {
  it("summarizes what the user seems drawn to, evidence, tensions, and a testable next action", () => {
    const memo = assembleWhatToBuildDecisionMemo({
      now,
      contextNodes: [
        node({
          id: "project-node",
          type: "project",
          label: "build a quiet research room",
          description: "A concrete environment for deeper work.",
          weight: 190,
          confidence: 82,
          evidenceCount: 4,
        }),
        node({
          id: "tension-node",
          type: "tension",
          label: "wanting solitude and collaborators",
          description: "The direction needs both focus and people.",
          weight: 160,
          confidence: 76,
          evidenceCount: 3,
        }),
        node({
          id: "theme-node",
          type: "theme",
          label: "careful rituals",
          weight: 80,
          evidenceCount: 2,
        }),
      ],
      evidence: [
        evidence({
          contextNodeId: "theme-node",
          signalId: "signal-theme",
          weight: 40,
          resonanceScore: 50,
        }),
        evidence({
          contextNodeId: "project-node",
          signalId: "signal-project",
          reason: "The signal names a room-like product shape.",
          weight: 92,
          resonanceScore: 88,
          packetText: "WHY_IT_MATTERS: the work seems worth building when it protects attention",
        }),
        evidence({
          contextNodeId: "tension-node",
          signalId: "signal-tension",
          reason: "The signal repeats the solitude/collaboration conflict.",
          weight: 84,
          resonanceScore: 81,
        }),
      ],
      topOfMindNotes: [
        {
          id: "note-1",
          title: "The room keeps returning",
          body: "Several signals point at a room for deep work.",
          type: "pattern",
          confidence: 86,
          status: "active",
          relatedContextNodeIds: ["project-node"],
          relatedSignalIds: ["signal-project"],
        },
      ],
    });

    expect(memo).toMatchObject({
      generatedAt: "2026-05-30T12:00:00.000Z",
      title: "What to build next",
      isScaffold: true,
      drawnTo: {
        summary: "You seem drawn to build a quiet research room, with wanting solitude and collaborators close behind.",
      },
      topOfMindNotes: [
        {
          id: "note-1",
          title: "The room keeps returning",
          type: "pattern",
          confidence: 86,
          status: "active",
        },
      ],
      nextAction: "Prototype one small version of build a quiet research room that directly tests the tension around wanting solitude and collaborators.",
    });
    expect(memo.drawnTo.contextNodes.slice(0, 2)).toMatchObject([
      {
        id: "project-node",
        type: "project",
        label: "build a quiet research room",
      },
      {
        id: "tension-node",
        type: "tension",
        label: "wanting solitude and collaborators",
      },
    ]);
    expect(memo.strongestEvidence[0]).toMatchObject({
      signalId: "signal-project",
      contextNodeId: "project-node",
      contextNodeLabel: "build a quiet research room",
      reason: "The signal names a room-like product shape.",
      textPreview: "WHY_IT_MATTERS: the work seems worth building when it protects attention",
      resonanceScore: 88,
    });
    expect(memo.tensions[0]).toMatchObject({
      contextNodeId: "tension-node",
      label: "wanting solitude and collaborators",
    });
    expect(memo.strongestEvidence.map((item) => item.signalId)).toEqual([
      "signal-project",
      "signal-tension",
      "signal-theme",
    ]);
  });

  it("keeps the scaffold honest when graph evidence is still thin", () => {
    const memo = assembleWhatToBuildDecisionMemo({
      now,
      contextNodes: [],
      evidence: [],
      topOfMindNotes: [],
    });

    expect(memo.drawnTo.summary).toBe(
      "Not enough context graph evidence yet. Capture a few more high-resonance signals before trusting a build direction.",
    );
    expect(memo.strongestEvidence).toEqual([]);
    expect(memo.tensions).toEqual([]);
    expect(memo.nextAction).toBe(
      "Capture three concrete signals from what you keep wanting to make, then regenerate this memo.",
    );
  });
});
