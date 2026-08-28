/**
 * A DARK ROOM SAYS WHICH DARK IT IS IN.
 *
 * goal: lighting-a-room, Phase 2.
 *
 * A room's silence is designed. It reads its members' PUBLIC memories, and it
 * serves a statement only once memories from more than one member stand under
 * it — so a room of one, a room where nobody has opened anything, a room whose
 * ground is all one person's, and a room whose first statement nobody has
 * answered are all correctly dark, for four different reasons, needing four
 * different acts to move.
 *
 * All four rendered the same sentence: "Forming — nothing read together yet."
 * That line is not wrong about any of them and is useful about none of them,
 * because the one thing a person standing in a dark room needs is what to DO,
 * and it names no act at all.
 *
 * Three claims, and the first is the one with teeth:
 *
 *   1. THE ORDER IS A PRECONDITION CHAIN, NOT A PREFERENCE. Each stage is
 *      required by the next: nobody in the room means no ground worth having,
 *      no ground means no two-voiced statement, no statement means nothing to
 *      answer. Report the nearest missing thing instead of the FIRST and you
 *      tell somebody alone in a room to go and affirm a statement — advice
 *      that cannot work, about a problem they do not have. That failure is
 *      invisible to a screenshot, because each sentence is perfectly sensible
 *      on its own.
 *
 *   2. EVERY STAGE NAMES AN ACT. A state with no verb in it is the old line
 *      again with more words.
 *
 *   3. NO NUMERALS, ANYWHERE. The founder's law is that states render and
 *      numerals never — and this function is handed three counts, which makes
 *      it the likeliest place in the product for one to leak onto a surface.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and nothing needs replacing.
 * `groupStage` and `groupStageWords` are total functions of three numbers and
 * a union — no clock, no network, no database, no DOM. There is no layer here
 * to stand in for, so a mock could only be a second copy of the arithmetic
 * under test, which is the exact failure G6 exists to catch. Where those three
 * numbers COME FROM (the roll, the ground and the wall, fetched together
 * before a room may wake) is a wiring question, and it is answered by the
 * browser walk `tools/e2e/lighting.ts` against a real stack rather than by
 * mocking the fetches here.
 */
import { describe, expect, it } from "vitest";

import { groupStage, groupStageWords, type GroupStage } from "../src/space-kinds/group";

const ALL: GroupStage[] = ["alone", "bare", "one-voiced", "unanswered"];

describe("which dark a room is in", () => {
  it("reports the first missing thing, not the nearest one", () => {
    /* A room with nobody else in it, no ground and no wall is missing all
       three. It must say the FIRST — the invite — because the other two
       cannot be acted on until somebody is there to act with. */
    expect(groupStage({ members: 1, ground: 0, wall: 0 })).toBe("alone");

    /* And it stays "alone" however much the person alone in it has opened:
       a ground of your own is not a room, and telling somebody to keep
       opening memories would be telling them to keep talking to nobody. */
    expect(groupStage({ members: 1, ground: 9, wall: 0 })).toBe("alone");
  });

  it("walks the stages in order as each act lands", () => {
    /* The lifecycle of one room, in the order a person actually moves it. */
    expect(groupStage({ members: 1, ground: 0, wall: 0 })).toBe("alone");
    expect(groupStage({ members: 2, ground: 0, wall: 0 })).toBe("bare");
    expect(groupStage({ members: 2, ground: 4, wall: 0 })).toBe("one-voiced");
    expect(groupStage({ members: 2, ground: 4, wall: 1 })).toBe("unanswered");
  });

  it("does not skip a stage when a later one is already satisfied", () => {
    /* THE ORDERING BUG, WRITTEN DOWN. A room can hold a statement from before
       somebody left, so "has a wall" and "has nobody else in it" can both be
       true at once. The room is alone; the standing statement does not make
       it answerable. */
    expect(groupStage({ members: 1, ground: 4, wall: 2 })).toBe("alone");
    /* Likewise a room whose members all closed their memories again: the
       wall's statements are withheld at serve time, and what the room needs
       is the ground back, not an answer. */
    expect(groupStage({ members: 3, ground: 0, wall: 2 })).toBe("bare");
  });

  it("gives every stage a sentence that names an act", () => {
    /* A VERB EACH, and they must be different verbs: four states pointing at
       the same act would be the old single line wearing four coats. */
    const acts: Record<GroupStage, RegExp> = {
      alone: /invite/i,
      bare: /open/i,
      "one-voiced": /stands under|keep open/i,
      unanswered: /say/i,
    };
    for (const stage of ALL) {
      const words = groupStageWords(stage);
      expect(words, `${stage} says nothing`).not.toHaveLength(0);
      expect(words, `${stage} names no act`).toMatch(acts[stage]);
    }
    expect(new Set(ALL.map(groupStageWords)).size, "two stages say the same thing").toBe(
      ALL.length,
    );
  });

  it("never prints a numeral", () => {
    /* The law, checked where the counts actually are. "More than one of you"
       is the two-voices rule in words and is the closest this may come. */
    for (const stage of ALL) {
      expect(groupStageWords(stage), `${stage} leaked a number`).not.toMatch(/\d/);
    }
  });

  it("reads as prose rather than as furniture", () => {
    /* The same rule `first-sixty` measures the empty surfaces by: a label is
       uppercased by CSS, a sentence is written to be read. Each of these is a
       whole sentence, ending in a full stop. */
    for (const stage of ALL) {
      const words = groupStageWords(stage);
      expect(words, `${stage} is not a sentence`).toMatch(/\.$/);
      expect(words.split(/\s+/).length, `${stage} is too terse to be prose`).toBeGreaterThan(5);
    }
  });
});
