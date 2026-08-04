import { describe, expect, it } from "vitest";

import {
  BOARD_COVERAGE_WEIGHT,
  BOARD_DISTINCTNESS_WEIGHT,
  BOARD_QUALITY_WEIGHT,
  selectBoard,
  type SelectableCandidate,
} from "./board-selection.js";

/**
 * Readings live in a high-dimensional space where even unrelated text sits near
 * 0.69 similarity. Two dimensions is enough to express "these say the same
 * thing" and "this one does not", which is the only property selection uses.
 */
function candidate(
  id: string,
  vector: [number, number],
  ownerIds: string[],
  overrides: Partial<SelectableCandidate> = {},
): SelectableCandidate {
  return { id, embedding: vector, ownerIds, quality: 0.5, ...overrides };
}

/** Five readings that mean the same thing, plus one that does not. */
const SAME = (id: string, owners: string[]) => candidate(id, [1, 0.02], owners);
const DIFFERENT = (id: string, owners: string[]) => candidate(id, [0.02, 1], owners);

describe("selectBoard", () => {
  it("reaches the one distinct reading immediately, not last", () => {
    const board = selectBoard(
      [
        SAME("a", ["u1", "u2"]),
        SAME("b", ["u1", "u2"]),
        SAME("c", ["u1", "u2"]),
        SAME("d", ["u1", "u2"]),
        SAME("e", ["u1", "u2"]),
        DIFFERENT("z", ["u1", "u2"]),
      ],
      3,
    );
    // The failure this exists to prevent: arrival order puts the odd one out
    // sixth, so a board of three is three phrasings of one idea.
    expect(board.map((c) => c.id)).toContain("z");
    expect(board.slice(0, 2).map((c) => c.id)).toContain("z");
  });

  it("prefers a reading that speaks for someone the board does not", () => {
    const board = selectBoard(
      [
        candidate("seed", [1, 0], ["u1", "u2"], { quality: 1 }),
        // Marginally more distinct, but the same two people again.
        candidate("distinct-same-people", [0, 1], ["u1", "u2"]),
        // Slightly less distinct, but brings a member nobody speaks for.
        candidate("newcomer", [0.25, 1], ["u3", "u4"]),
      ],
      2,
    );
    expect(board.map((c) => c.id)).toEqual(["seed", "newcomer"]);
  });

  it("keeps a re-confirmed reading even when selection would not pick it", () => {
    /**
     * A reading the pass reached again has been CONFIRMED, not superseded.
     * Dropping one because a fresher-looking candidate scored higher already
     * cost a real board two of its six notes, and would make the wall churn
     * between refreshes for reasons no one could see.
     */
    const board = selectBoard(
      [
        candidate("stable", [1, 0], ["u1", "u2"], { quality: 0.01, reconfirmed: true }),
        candidate("shiny", [0, 1], ["u3", "u4"], { quality: 1 }),
      ],
      2,
    );
    expect(board.map((c) => c.id)).toContain("stable");
  });

  it("is independent of the order candidates arrive in", () => {
    const pool = [
      SAME("a", ["u1", "u2"]),
      DIFFERENT("z", ["u3", "u4"]),
      SAME("b", ["u1", "u2"]),
      candidate("m", [0.7, 0.7], ["u2", "u5"]),
      SAME("c", ["u1", "u2"]),
    ];
    const forwards = selectBoard(pool, 3).map((c) => c.id);
    const backwards = selectBoard([...pool].reverse(), 3).map((c) => c.id);
    const shuffled = selectBoard([pool[3]!, pool[0]!, pool[4]!, pool[1]!, pool[2]!], 3)
      .map((c) => c.id);
    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it("still spreads a board whose readings are all nearly identical", () => {
    /**
     * The tight-room case, and why distance is scored by rank rather than by
     * an absolute cut. Every pair here sits above 0.99; an absolute threshold
     * would either accept all of them or reject all of them, and the board
     * would fall back to arrival order.
     */
    const board = selectBoard(
      [
        candidate("a", [1, 0.10], ["u1", "u2"]),
        candidate("b", [1, 0.11], ["u1", "u2"]),
        candidate("c", [1, 0.12], ["u1", "u2"]),
        candidate("d", [1, 0.30], ["u1", "u2"]),
      ],
      2,
    );
    expect(board).toHaveLength(2);
    // The furthest available, not simply the next in line.
    expect(board.map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("returns everything it has when there are fewer candidates than places", () => {
    const board = selectBoard([SAME("a", ["u1", "u2"])], 6);
    expect(board.map((c) => c.id)).toEqual(["a"]);
  });

  it("returns nothing for a board with no places", () => {
    expect(selectBoard([SAME("a", ["u1", "u2"])], 0)).toEqual([]);
  });

  /**
   * Pinned like every other tuned number in this directory. Coverage above
   * distinctness is a product decision — a member absent from a board is a
   * person whose signals were never read alongside the others — and quality is
   * deliberately low so selection does not rebuild arrival order under a new
   * name.
   */
  it("holds the weights", () => {
    expect(BOARD_QUALITY_WEIGHT).toBe(0.2);
    expect(BOARD_COVERAGE_WEIGHT).toBe(0.5);
    expect(BOARD_DISTINCTNESS_WEIGHT).toBe(0.3);
    expect(BOARD_COVERAGE_WEIGHT).toBeGreaterThan(BOARD_DISTINCTNESS_WEIGHT);
    expect(BOARD_QUALITY_WEIGHT).toBeLessThan(BOARD_DISTINCTNESS_WEIGHT);
  });
});
