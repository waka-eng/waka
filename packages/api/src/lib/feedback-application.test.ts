import { describe, expect, it } from "vitest";

import {
  feedbackMutatesContextNodes,
  planFeedbackApplication,
  readAppliedTopOfMindStatus,
} from "./feedback-application.js";
import type { FeedbackValue } from "../db/index.js";

describe("planFeedbackApplication", () => {
  it.each([
    [
      "true",
      {
        topOfMindNoteStatus: "active",
        nodeStatus: "active",
        weightDelta: 14,
        confidenceDelta: 6,
        correctionRequested: false,
      },
    ],
    [
      "important",
      {
        topOfMindNoteStatus: "active",
        nodeStatus: "active",
        weightDelta: 18,
        confidenceDelta: 4,
        correctionRequested: false,
      },
    ],
    [
      "not_true",
      {
        topOfMindNoteStatus: "stale",
        nodeStatus: "stale",
        weightDelta: -26,
        confidenceDelta: -16,
        correctionRequested: false,
      },
    ],
    [
      "not_important",
      {
        topOfMindNoteStatus: "dismissed",
        nodeStatus: "stale",
        weightDelta: -20,
        confidenceDelta: -8,
        correctionRequested: false,
      },
    ],
  ] as const)(
    "maps %s feedback to deterministic note and graph updates",
    (value, expected) => {
      expect(planFeedbackApplication({ value })).toEqual(expected);
    },
  );

  it("preserves partly feedback and asks for correction when none is supplied", () => {
    expect(planFeedbackApplication({ value: "partly" })).toEqual({
      topOfMindNoteStatus: "active",
      nodeStatus: "active",
      weightDelta: 4,
      confidenceDelta: 0,
      correctionRequested: true,
    });

    expect(
      planFeedbackApplication({
        value: "partly",
        correctionText: "The signal is about agency, not taste.",
      }).correctionRequested,
    ).toBe(false);
  });

  it("covers every feedback value explicitly", () => {
    const values: FeedbackValue[] = [
      "true",
      "partly",
      "not_true",
      "important",
      "not_important",
    ];

    expect(values.map((value) => planFeedbackApplication({ value }))).toHaveLength(5);
  });
});

describe("feedbackMutatesContextNodes", () => {
  it("never lets top-of-mind note feedback mutate the meaning graph", () => {
    expect(feedbackMutatesContextNodes("top_of_mind_note")).toBe(false);
  });

  it("still applies signal, context_node, and hypothesis feedback to the graph", () => {
    expect(feedbackMutatesContextNodes("signal")).toBe(true);
    expect(feedbackMutatesContextNodes("context_node")).toBe(true);
    expect(feedbackMutatesContextNodes("hypothesis")).toBe(true);
  });
});

describe("readAppliedTopOfMindStatus", () => {
  it("reads note status from applied feedback provenance", () => {
    expect(
      readAppliedTopOfMindStatus({
        appliedFeedback: {
          source: "user_feedback",
          topOfMindNoteStatus: "dismissed",
        },
      }),
    ).toBe("dismissed");
  });

  it("ignores missing or invalid applied feedback metadata", () => {
    expect(readAppliedTopOfMindStatus({})).toBeNull();
    expect(
      readAppliedTopOfMindStatus({
        appliedFeedback: { topOfMindNoteStatus: "archived" },
      }),
    ).toBeNull();
  });
});
