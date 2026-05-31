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
      title: "I need places that quietly tell me to be braver.",
      ambitionDimension: "place",
      ambientSignal: "I need places that quietly tell me to be braver.",
      matchedEnvironment:
        "A city, studio, or room where a provisional reflection feels publicly reinforced.",
      antiEnvironment: "Settings that make ambition feel private, apologetic, or over-explained.",
      evidenceRationale:
        "This post-it is inferred from saved signals and may change as the graph gets better evidence.",
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

    expect(note.title).toBe("I need places that quietly tell me to be braver.");
    expect(note.title).not.toBe("founder cities");
    expect(note.title).not.toMatch(/^You keep circling\b/);
    expect(note.title).not.toMatch(/rooms where .+ can become normal/i);
    expect(note.ambitionDimension).toBe("place");
  });

  it("exposes ambient signal fields embedded by graph refresh notes", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        title: "I want peers who make fast, public building feel normal.",
        why:
          "Ambient signal: I want peers who make fast, public building feel normal. " +
          "Matched environment: People who make publishing early feel ordinary. " +
          "Anti-environment: Circles where permission arrives before motion. " +
          "Evidence rationale: Three saved signals are clustering around this frequency. " +
          "This may matter for ambition because it points at a people frequency.",
        beliefStatement: "I want peers who make fast, public building feel normal.",
      },
    });

    expect(note).toMatchObject({
      ambientSignal: "I want peers who make fast, public building feel normal.",
      matchedEnvironment: "People who make publishing early feel ordinary.",
      antiEnvironment: "Circles where permission arrives before motion.",
      evidenceRationale: "Three saved signals are clustering around this frequency.",
      body: "This may matter for ambition because it points at a people frequency.",
    });
  });

  it("rewrites older outside-voice primary post-it text into first-person jotting", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        title: "You seem to want peers who make fast, public building feel normal.",
        why:
          "Ambient signal: You seem to want peers who make fast, public building feel normal. " +
          "Matched environment: People who make publishing early feel ordinary. " +
          "Anti-environment: Circles where permission arrives before motion. " +
          "Evidence rationale: Three saved signals are clustering around this frequency. " +
          "This may matter for ambition because it points at a people frequency.",
        beliefStatement: "You seem to want peers who make fast, public building feel normal.",
      },
    });

    expect(note.title).toBe("I want peers who make fast, public building feel normal.");
    expect(note.ambientSignal).toBe("I want peers who make fast, public building feel normal.");
    expect(note.title).not.toMatch(/^(You|Your|This person|WAKA)\b/i);
    expect(note.ambientSignal).not.toMatch(/^(You|Your|This person|WAKA)\b/i);
    expect(note.title).not.toMatch(/\b(I think|maybe|might|probably|seems)\b/i);
    expect(note.ambientSignal).not.toMatch(/\b(I think|maybe|might|probably|seems)\b/i);
  });
});
