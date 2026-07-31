import { describe, expect, it } from "vitest";

import {
  buildMemberLabels,
  buildUserPrompt,
  type WowJudgeInput,
} from "./wow-judge.js";

/**
 * A group judgment has to be able to ask what a *combination* reveals, not
 * only what a bigger pool has in common. That needs two things the group path
 * lacked: ownership surviving into the prompt, and the task changing when it
 * does.
 */

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

function insp(id: string, userId: string, text: string) {
  return {
    id,
    userId,
    text,
    kind: "note" as const,
    category: null,
    cluster: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };
}

const retrieved = {
  trigger: insp("t1", A, "a hallway that tells you where to stand"),
  candidates: [
    { inspiration: insp("c1", B, "the hiring doc nobody could parse"), scores: { runtimeCandidateScore: 0.8 } },
    { inspiration: insp("c2", A, "the shop that put its bench in the window"), scores: { runtimeCandidateScore: 0.7 } },
  ],
} as never;

describe("buildMemberLabels", () => {
  it("labels each signal by owner, anonymously", () => {
    const labels = buildMemberLabels(retrieved, [B, A]);

    expect(new Set(Object.values(labels)).size).toBe(2);
    // Two signals from the same person share a label; the third does not.
    expect(labels.t1).toBe(labels.c2);
    expect(labels.t1).not.toBe(labels.c1);

    // Anonymous: no real user id reaches the model.
    for (const label of Object.values(labels)) {
      expect(label).toMatch(/^member [A-Z]$/);
      expect(label).not.toContain(A);
      expect(label).not.toContain(B);
    }
  });

  it("is stable regardless of the order members are passed in", () => {
    // A room should not relabel itself between runs.
    expect(buildMemberLabels(retrieved, [A, B])).toEqual(buildMemberLabels(retrieved, [B, A]));
  });

  it("keeps labels distinct past 26 members", () => {
    // Wrapping at Z gave two people the same letter, which collapses exactly
    // the distinction the group task rests on: a note must be grounded in two
    // *different* members, and two members the judge cannot tell apart read as
    // one. Group size is unbounded — anyone holding the code joins.
    const many = Array.from(
      { length: 30 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const trigger = insp("t1", many[0]!, "one signal");
    const labels = buildMemberLabels(
      {
        trigger,
        candidates: many.slice(1).map((userId, i) => ({
          inspiration: insp(`c${i}`, userId, "another signal"),
          scores: { runtimeCandidateScore: 0.5 },
        })),
      } as never,
      many,
    );

    expect(new Set(Object.values(labels)).size).toBe(30);
    expect(Object.values(labels)).toContain("member AA");
  });
});

describe("the task the judge is given", () => {
  const base: WowJudgeInput = {
    trigger: insp("t1", A, "a hallway") as never,
    candidates: [{ ...insp("c1", B, "a hiring doc"), scores: { runtimeCandidateScore: 0.5 } } as never],
  };

  it("asks the combination question only when signals carry owners", () => {
    const group = JSON.parse(buildUserPrompt({ ...base, memberLabelsBySignalId: { t1: "member A", c1: "member B" } }));
    const personal = JSON.parse(buildUserPrompt(base));

    expect(group.task).toContain("ONLY because these particular collections sit next to each other");
    expect(group.task).toContain("at least two different members");

    // The personal path must be untouched: one owner means asking whose signal
    // this is would be noise, and the wording it has is tuned.
    expect(personal.task).not.toContain("members");
    expect(personal.input.trigger.savedBy).toBeUndefined();
  });

  it("tags each signal with who saved it, on group judgments only", () => {
    const group = JSON.parse(buildUserPrompt({ ...base, memberLabelsBySignalId: { t1: "member A", c1: "member B" } }));
    expect(group.input.trigger.savedBy).toBe("member A");
    expect(group.input.candidates[0].savedBy).toBe("member B");
  });
});
