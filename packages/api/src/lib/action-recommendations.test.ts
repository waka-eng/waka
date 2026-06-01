import { describe, expect, it } from "vitest";

import { recommendActionsFromTopOfMind } from "./action-recommendations.js";
import type { TopOfMindNoteSurface } from "../routes/top-of-mind.js";

const baseNote: TopOfMindNoteSurface = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000001",
  title: "make the thing before explaining it",
  ambitionDimension: "work",
  ambientSignal: "make the thing before explaining it",
  matchedEnvironment: "A room where rough artifacts become public quickly",
  antiEnvironment: "Commentary loops where nothing gets made",
  evidenceRationale: "Saved signals keep returning to public rough drafts.",
  rejectedAlternativeInterpretation: null,
  type: "pattern",
  body: "Several saved signals connect building, showing, and learning from the room.",
  prompt: null,
  guidance: null,
  confidence: 82,
  status: "active",
  relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
  relatedContextNodeIds: ["00000000-0000-4000-8000-000000000201"],
  createdAt: new Date("2026-05-30T10:00:00.000Z"),
  updatedAt: new Date("2026-05-30T11:00:00.000Z"),
  source: "wow_moment_compatibility",
  isProvisional: true,
  legacy: {
    wowMomentId: "00000000-0000-4000-8000-000000000010",
    wowKind: "recurrence",
    wowScore: 82,
  },
  evidencePreviews: [
    {
      signalId: "00000000-0000-4000-8000-000000000101",
      role: "The practice",
      reason: "It names the practice.",
      textPreview: "Architecture essay about bridge rhythms in city walks",
      kind: "note",
      createdAt: "2026-05-29T10:00:00.000Z",
      resonanceScore: 9,
    },
  ],
  relatedSignals: [],
};

describe("recommendActionsFromTopOfMind", () => {
  it("ranks concrete evidence-backed experiments and rejects weak disconnected notes", () => {
    const actions = recommendActionsFromTopOfMind({
      notes: [
        baseNote,
        {
          ...baseNote,
          id: "00000000-0000-4000-8000-000000000011",
          title: "think about the future",
          confidence: 35,
          evidencePreviews: [],
          relatedSignalIds: [],
        },
      ],
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      text: "Make the rough thing first, then show one person before explaining it.",
      sourceTopOfMindId: baseNote.id,
      sourceSignalIds: ["00000000-0000-4000-8000-000000000101"],
      evidenceSnippets: ["Architecture essay about bridge rhythms in city walks"],
      kind: "make_artifact",
      status: "active",
    });
    expect(actions[0].confidence).toBeGreaterThanOrEqual(90);
    expect(actions[0].text).not.toMatch(
      /do one tiny|smallest test|explore this|reflect on|journal|learn more|think about|research/i,
    );
  });

  it("removes completed or dismissed actions from future recommendations", () => {
    const [action] = recommendActionsFromTopOfMind({ notes: [baseNote] });
    const actions = recommendActionsFromTopOfMind({
      notes: [baseNote],
      states: [
        {
          actionId: action.id,
          sourceTopOfMindId: baseNote.id,
          status: "completed",
          outcomeText: null,
          relatedSignalIds: [],
          updatedAt: new Date("2026-06-01T09:00:00.000Z"),
        },
      ],
    });

    expect(actions).toEqual([]);
  });

  it("strengthens future actions only when a completed action has an outcome", () => {
    const lowConfidenceNote = {
      ...baseNote,
      confidence: 49,
      evidencePreviews: [],
    };
    const emptyCompletion = {
      actionId: "previous-empty-action",
      sourceTopOfMindId: baseNote.id,
      status: "completed" as const,
      outcomeText: null,
      relatedSignalIds: [],
      updatedAt: new Date("2026-06-01T09:00:00.000Z"),
    };
    const outcomeCompletion = {
      ...emptyCompletion,
      actionId: "previous-outcome-action",
      outcomeText: "Showing the rough version led to a concrete invitation.",
    };

    expect(
      recommendActionsFromTopOfMind({
        notes: [lowConfidenceNote],
        states: [emptyCompletion],
      }),
    ).toEqual([]);

    const [action] = recommendActionsFromTopOfMind({
      notes: [lowConfidenceNote],
      states: [outcomeCompletion],
    });
    expect(action).toMatchObject({
      sourceTopOfMindId: baseNote.id,
      status: "active",
    });
    expect(action.confidence).toBeGreaterThanOrEqual(60);
  });
});
