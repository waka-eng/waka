import { describe, expect, it, vi } from "vitest";

import {
  recommendActionsFromTopOfMind,
  type ActionRecommendationGenerator,
} from "./action-recommendations.js";
import type { TopOfMindNoteSurface } from "../routes/top-of-mind.js";

const userId = "00000000-0000-4000-8000-000000000001";

const baseNote: TopOfMindNoteSurface = {
  id: "00000000-0000-4000-8000-000000000010",
  userId,
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

function generator(
  output: Awaited<ReturnType<ActionRecommendationGenerator["generateActionRecommendation"]>> = {
    text: "Draft the rough bridge-rhythm artifact and show it to one builder by Friday.",
    kind: "make_artifact" as const,
    whyNow: "The current post-it and evidence both point toward learning by making the rough thing public.",
  },
): ActionRecommendationGenerator {
  return {
    generateActionRecommendation: vi.fn(async () => output),
  };
}

describe("recommendActionsFromTopOfMind", () => {
  it("ranks concrete evidence-backed candidates but uses provider-generated action fields", async () => {
    const actionGenerator = generator();
    const actions = await recommendActionsFromTopOfMind({
      userId,
      generator: actionGenerator,
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
      text: "Draft the rough bridge-rhythm artifact and show it to one builder by Friday.",
      sourceTopOfMindId: baseNote.id,
      sourceSignalIds: ["00000000-0000-4000-8000-000000000101"],
      evidenceSnippets: ["Architecture essay about bridge rhythms in city walks"],
      kind: "make_artifact",
      whyNow:
        "The current post-it and evidence both point toward learning by making the rough thing public.",
      status: "active",
    });
    expect(actions[0].confidence).toBeGreaterThanOrEqual(90);
    expect(actionGenerator.generateActionRecommendation).toHaveBeenCalledTimes(1);
  });

  it("removes completed or dismissed actions from future recommendations", async () => {
    const [action] = await recommendActionsFromTopOfMind({
      userId,
      notes: [baseNote],
      generator: generator(),
    });
    const actions = await recommendActionsFromTopOfMind({
      userId,
      notes: [baseNote],
      generator: generator(),
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

  it("strengthens future candidates only when a completed action has an outcome", async () => {
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
      await recommendActionsFromTopOfMind({
        userId,
        notes: [lowConfidenceNote],
        generator: generator(),
        states: [emptyCompletion],
      }),
    ).toEqual([]);

    const [action] = await recommendActionsFromTopOfMind({
      userId,
      notes: [lowConfidenceNote],
      generator: generator(),
      states: [outcomeCompletion],
    });
    expect(action).toMatchObject({
      sourceTopOfMindId: baseNote.id,
      status: "active",
    });
    expect(action.confidence).toBeGreaterThanOrEqual(60);
  });

  it("returns empty or partial lists when generation fails or validates poorly", async () => {
    const mixedGenerator: ActionRecommendationGenerator = {
      generateActionRecommendation: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          text: "Make a small exhibit from the second signal and invite one person to react this week.",
          kind: "make_artifact",
          whyNow: "The second post-it has enough evidence to try in public now.",
        }),
    };

    const actions = await recommendActionsFromTopOfMind({
      userId,
      generator: mixedGenerator,
      notes: [
        baseNote,
        {
          ...baseNote,
          id: "00000000-0000-4000-8000-000000000012",
          title: "another public making loop",
          createdAt: new Date("2026-05-31T10:00:00.000Z"),
        },
      ],
    });

    expect(actions).toHaveLength(1);
    expect(actions[0].sourceTopOfMindId).toBe(baseNote.id);
  });

  it("keeps IDs stable and independent of generated text", async () => {
    const [first] = await recommendActionsFromTopOfMind({
      userId,
      notes: [baseNote],
      generator: generator({
        text: "Make the first rough bridge-rhythm sketch and show one person by Friday.",
        kind: "make_artifact",
        whyNow: "The evidence points at public rough drafts.",
      }),
    });
    const [second] = await recommendActionsFromTopOfMind({
      userId,
      notes: [baseNote],
      generator: generator({
        text: "Send one builder a rough bridge-rhythm draft and ask what feels alive.",
        kind: "message_person",
        whyNow: "The evidence points at testing the idea with another person.",
      }),
    });

    expect(first.id).toBe(second.id);
    expect(first.text).not.toBe(second.text);
  });
});
