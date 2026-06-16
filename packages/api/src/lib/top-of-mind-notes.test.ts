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
      title: "a room where unfinished ambition is allowed",
      ambitionDimension: "place",
      ambientSignal: "a room where unfinished ambition is allowed",
      matchedEnvironment: "",
      antiEnvironment: "",
      evidenceRationale: "",
      rejectedAlternativeInterpretation: null,
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

    expect(note.title).toBe("a room where unfinished ambition is allowed");
    expect(note.title).not.toBe("founder cities");
    expect(note.title).not.toMatch(/^You keep circling\b/);
    expect(note.title).not.toMatch(/rooms where .+ can become normal/i);
    expect(note.ambitionDimension).toBe("place");
  });

  it("exposes ambient signal fields embedded by graph refresh notes", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        title: "people who make courage feel normal",
        why:
          "Ambient signal: people who make courage feel normal. " +
          "Matched environment: People who make publishing early feel ordinary. " +
          "Anti-environment: Circles where permission arrives before motion. " +
          "Evidence rationale: Three saved signals are clustering around this frequency. " +
          "This may matter for ambition because it points at a people frequency.",
        beliefStatement: "people who make courage feel normal",
      },
    });

    expect(note).toMatchObject({
      ambientSignal: "people who make courage feel normal",
      matchedEnvironment: "People who make publishing early feel ordinary.",
      antiEnvironment: "Circles where permission arrives before motion.",
      evidenceRationale: "",
      body: "",
    });
  });

  it("rewrites older outside-voice primary post-it text into sticky-note thought language", () => {
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

    expect(note.title).toBe("people who make courage feel normal");
    expect(note.ambientSignal).toBe("people who make courage feel normal");
    expect(note.title).not.toMatch(/^(You|Your|This person|WAKA)\b/i);
    expect(note.ambientSignal).not.toMatch(/^(You|Your|This person|WAKA)\b/i);
    expect(note.title).not.toMatch(/^(I need|I want|I am|I'm|I refuse|I am done with)\b/i);
    expect(note.ambientSignal).not.toMatch(/^(I need|I want|I am|I'm|I refuse|I am done with)\b/i);
    expect(note.title).not.toMatch(/\b(I think|maybe|might|probably|seems)\b/i);
    expect(note.ambientSignal).not.toMatch(/\b(I think|maybe|might|probably|seems)\b/i);
    expect(note.title.split(/\s+/).length).toBeGreaterThanOrEqual(5);
    expect(note.title.split(/\s+/).length).toBeLessThanOrEqual(14);
  });

  it("rejects slogan-like legacy post-it text and replaces it with interpretable thought language", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        title: "build in public",
        why:
          "Ambient signal: public before perfect. " +
          "Matched environment: A working culture where making comes before polish. " +
          "Anti-environment: Work contexts that keep the real object abstract. " +
          "Evidence rationale: Two saved signals support this work direction. " +
          "This may matter for ambition because it points at a work frequency.",
        beliefStatement: "public before perfect",
      },
    });

    expect(note.title).toBe("a room where unfinished ambition is allowed");
    expect(note.ambientSignal).toBe("a room where unfinished ambition is allowed");
    expect(note.title).not.toMatch(
      /^(public before perfect|taste as default|test it outside|test it in public|courage normal)$/i,
    );
  });

  it("sanitizes legacy scaffolding out of every user-facing note field", () => {
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        title: "people who make courage feel normal",
        why:
          "Ambient signal: people who make courage feel normal. " +
          "Matched environment: People who make publishing early feel ordinary. " +
          "Anti-environment: Circles where permission arrives before motion. " +
          "Evidence rationale: Three saved signals are clustering around this frequency. " +
          "This may matter for ambition because it points at a people frequency. " +
          "Supporting signals: \"shipping early\". " +
          "Memory movement: 3 reinforcements; rank 2 score 94 candidate abc.",
        beliefStatement: "people who make courage feel normal",
      },
    });

    const payload = JSON.stringify(note);
    expect(payload).not.toContain("This may matter for ambition because it points");
    expect(payload).not.toContain("Memory movement:");
    expect(payload).not.toContain("Supporting signals:");
    expect(payload).not.toContain("Ambient signal:");
    expect(payload).not.toContain("Matched environment:");
    expect(payload).not.toContain("Anti-environment:");
    expect(payload).not.toContain("Evidence rationale:");
    expect(note.evidenceRationale).toBe("");
    expect(note.body).toBe("");
  });

  it("keeps legitimate prose containing candidate, rank, and score", () => {
    const legitimateProse = "a candidate city where the music score makes rank feel irrelevant";
    const note = topOfMindNoteFromWowMoment({
      moment: {
        ...baseMoment,
        title: "candidate city signal",
        why: legitimateProse,
        beliefStatement: "a city where score matters less than atmosphere",
      },
    });

    expect(note.body).toBe(legitimateProse);
  });
});
