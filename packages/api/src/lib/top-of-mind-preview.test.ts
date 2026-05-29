import { describe, expect, it } from "vitest";

import { rankTopOfMindPreview } from "./top-of-mind-preview.js";

const now = new Date("2026-05-24T12:00:00.000Z");

describe("rankTopOfMindPreview", () => {
  it("returns an empty-state preview when no graph exists", () => {
    const preview = rankTopOfMindPreview({
      generatedAt: now,
      inspirationCount: 0,
      meaningNoteCount: 0,
      relationshipEdgeCount: 0,
      nodes: [],
      edges: [],
      evidence: [],
    });

    expect(preview).toMatchObject({
      generatedAt: now.toISOString(),
      headline: "No inspirations saved yet",
      activeThemes: [],
      activeQuestions: [],
      relationshipSignals: [],
      summary: {
        inspirationCount: 0,
        meaningNoteCount: 0,
        relationshipEdgeCount: 0,
      },
    });
  });

  it("does not turn saved inspirations into top-of-mind without meaning graph nodes", () => {
    const preview = rankTopOfMindPreview({
      generatedAt: now,
      inspirationCount: 3,
      meaningNoteCount: 0,
      relationshipEdgeCount: 0,
      nodes: [],
      edges: [],
      evidence: [],
    });

    expect(preview).toMatchObject({
      headline: "Top of mind is not ready yet",
      activeThemes: [],
      activeQuestions: [],
      relationshipSignals: [],
      summary: {
        inspirationCount: 3,
        meaningNoteCount: 0,
        relationshipEdgeCount: 0,
      },
    });
  });

  it("promotes repeated question-like meaning notes and supporting inspirations", () => {
    const preview = rankTopOfMindPreview({
      generatedAt: now,
      inspirationCount: 12,
      meaningNoteCount: 3,
      relationshipEdgeCount: 1,
      nodes: [
        {
          id: "node-question",
          type: "question",
          label: "what kind of life would make this work worth it",
          description: "The saves ask whether work is connected to a life worth living.",
          weight: 250,
          evidenceCount: 4,
          lastReinforcedAt: new Date("2026-05-24T10:00:00.000Z"),
        },
        {
          id: "node-theme",
          type: "value",
          label: "rooms where people can be honest before they are impressive",
          description: "The saves keep returning to less performative ambition.",
          weight: 210,
          evidenceCount: 3,
          lastReinforcedAt: new Date("2026-05-23T10:00:00.000Z"),
        },
        {
          id: "node-claim",
          type: "claim",
          label: "shipping gets cheaper",
          description: "",
          weight: 300,
          evidenceCount: 1,
          lastReinforcedAt: new Date("2026-05-24T09:00:00.000Z"),
        },
      ],
      edges: [
        {
          id: "edge-1",
          sourceNodeId: "node-question",
          targetNodeId: "node-theme",
          kind: "points_to",
          weight: 120,
          evidenceCount: 2,
          lastReinforcedAt: new Date("2026-05-24T10:30:00.000Z"),
        },
      ],
      evidence: [
        {
          meaningNodeId: "node-question",
          inspirationId: "insp-1",
          reason: "This save directly raises the life/work question.",
          weight: 90,
          createdAt: new Date("2026-05-24T10:00:00.000Z"),
          inspirationText: "Work should connect to a life worth living.",
          inspirationCreatedAt: new Date("2026-05-24T10:00:00.000Z"),
          sparkText: "life worth living",
        },
        {
          meaningNodeId: "node-question",
          inspirationId: "insp-2",
          reason: "This save reinforces the same question.",
          weight: 80,
          createdAt: new Date("2026-05-23T10:00:00.000Z"),
          inspirationText: "What kind of work would make the life around it better?",
          inspirationCreatedAt: new Date("2026-05-23T10:00:00.000Z"),
          sparkText: "",
        },
        {
          meaningNodeId: "node-theme",
          inspirationId: "insp-3",
          reason: "This save describes the desired room.",
          weight: 70,
          createdAt: new Date("2026-05-22T10:00:00.000Z"),
          inspirationText: "Rooms where people can be honest before they are impressive.",
          inspirationCreatedAt: new Date("2026-05-22T10:00:00.000Z"),
          sparkText: "honest before impressive",
        },
      ],
    });

    expect(preview.headline).toBe(
      "Top of mind: what kind of life would make this work worth it",
    );
    expect(preview.activeQuestions[0]).toMatchObject({
      nodeId: "node-question",
      label: "what kind of life would make this work worth it",
      reason: "The saves ask whether work is connected to a life worth living.",
      evidenceCount: 4,
      supportingInspirations: [
        expect.objectContaining({
          id: "insp-1",
          preview: "life worth living",
        }),
        expect.objectContaining({
          id: "insp-2",
          preview: "What kind of work would make the life around it better?",
        }),
      ],
    });
    expect(preview.activeThemes[0]).toMatchObject({
      nodeId: "node-theme",
      label: "rooms where people can be honest before they are impressive",
    });
    expect(preview.relationshipSignals).toEqual([
      expect.objectContaining({
        edgeId: "edge-1",
        kind: "points_to",
        reason:
          "what kind of life would make this work worth it points to rooms where people can be honest before they are impressive",
      }),
    ]);
  });
});
