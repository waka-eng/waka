import { describe, expect, it } from "vitest";

import {
  topOfMindNoteFromWowMoment,
  topOfMindNoteTypeFromWowMoment,
  topOfMindNoteTypeValues,
} from "./top-of-mind-notes.js";

const baseMoment = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  title: "A provisional reflection",
  kind: "bridge" as const,
  why: "Several signals point at the same ambition pattern.",
  beliefStatement: "You keep circling the rooms where ambition feels humane.",
  reflectionQuestion: null,
  reflectionGuide: null,
  wowScore: 87,
  createdAt: new Date("2026-05-30T12:00:00.000Z"),
  updatedAt: new Date("2026-05-30T12:05:00.000Z"),
};

describe("top-of-mind note compatibility model", () => {
  it("exposes the supported post-it note types", () => {
    expect(topOfMindNoteTypeValues).toEqual([
      "pattern",
      "tension",
      "question",
      "hypothesis",
      "action",
    ]);
  });

  it("maps WOW kinds and reflection fields into top-of-mind note types", () => {
    expect(topOfMindNoteTypeFromWowMoment({ kind: "recurrence" })).toBe("pattern");
    expect(topOfMindNoteTypeFromWowMoment({ kind: "bridge" })).toBe("pattern");
    expect(topOfMindNoteTypeFromWowMoment({ kind: "tension" })).toBe("tension");
    expect(topOfMindNoteTypeFromWowMoment({ kind: "surprise_bridge" })).toBe("hypothesis");
    expect(topOfMindNoteTypeFromWowMoment({ kind: "outlier" })).toBe("hypothesis");
    expect(
      topOfMindNoteTypeFromWowMoment({
        kind: "bridge",
        reflectionQuestion: "What is the open question?",
      }),
    ).toBe("question");
    expect(
      topOfMindNoteTypeFromWowMoment({
        kind: "recurrence",
        reflectionGuide: "Try one small experiment.",
      }),
    ).toBe("action");
  });

  it("serializes a WOW moment as an active provisional top-of-mind note", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        reflectionQuestion: "What should stay unresolved?",
        reflectionGuide: "Keep this as a replaceable post-it.",
        wowScore: 101,
      },
      relatedSignalIds: ["signal-1", "signal-2", "signal-1", ""],
      relatedContextNodeIds: ["node-1", "node-1"],
    });

    expect(note).toEqual({
      id: baseMoment.id,
      userId: baseMoment.userId,
      title: "You seem pulled toward the rooms where ambition feels humane.",
      ambitionDimension: "place",
      type: "question",
      body: baseMoment.why,
      prompt: "What should stay unresolved?",
      guidance: "Keep this as a replaceable post-it.",
      confidence: 100,
      status: "active",
      relatedSignalIds: ["signal-1", "signal-2"],
      relatedContextNodeIds: ["node-1"],
      createdAt: baseMoment.createdAt,
      updatedAt: baseMoment.updatedAt,
      source: "wow_moment_compatibility",
      isProvisional: true,
      legacy: {
        wowMomentId: baseMoment.id,
        wowKind: "bridge",
        wowScore: 101,
      },
    });
  });

  it("turns legacy summary titles into top-of-mind reflections", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        beliefStatement: "This may point to founder cities.",
        title: "founder cities",
      },
    });

    expect(note.title).toBe("You seem pulled toward rooms where founder cities can become normal.");
    expect(note.title).not.toBe("founder cities");
    expect(note.title).not.toMatch(/^You keep circling\b/);
    expect(note.ambitionDimension).toBe("place");
  });
});
