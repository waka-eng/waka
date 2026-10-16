/**
 * THE FIELD SAYS HOW MUCH OF YOU IS STANDING ON A MEMORY.
 *
 * Founder, 2026-08-24: "the inspiration ball's brightness should indicate how
 * active this one is being used to form signals, top of mind, and principle —
 * but right now everything has the same brightness." It did: being cited was
 * a BOOLEAN, so the save a principle, the poster and three patterns all rest
 * on was lit exactly like the one a single emerging pattern mentions once.
 *
 * Two halves, and a test of either alone would pass while the feature was
 * broken:
 *
 *   THE WIRING — `skyOf` must derive the three facts (roots, on the poster,
 *   under a principle) from the same citation index and the same layer-3 and
 *   layer-4 id sets the page builds. A light graded off facts nobody computed
 *   is a light that never moves.
 *
 *   THE GRADIENT — `colorBall`, the function the render loop actually calls,
 *   must light four memories of the SAME AGE differently in the order of what
 *   they hold up. Same age is the whole point: any brightness difference here
 *   is carry and nothing else, because decay is identical by construction.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. Every function under test is
 * pure — a ball and a number in, a number out — and the balls are built by
 * the product's own constructors (`seedOf` → `makeBall`) rather than typed
 * out here, so a change to what a ball IS reaches this file as a compile
 * error rather than as a stale fixture that keeps passing.
 */
import { describe, expect, it } from "vitest";

import {
  carryOf,
  FIELD_CARRY_POSTER_SHARE,
  FIELD_CARRY_PRINCIPLE_SHARE,
  FIELD_CARRY_PROMOTED_SHARE,
  FIELD_CARRY_PROMOTION_EVIDENCE,
  FIELD_CARRY_ROOT_SATURATION,
  FIELD_CARRY_ROOTS_SHARE,
} from "../src/lib/aliveness";
import type { Evidence, Inspiration, Signal } from "../src/lib/data";
import { colorBall } from "../src/space/inspiration/field";
import { makeBall, seedOf, skyOf } from "../src/space/inspiration/orb";

const NOW = Date.UTC(2026, 7, 24);
const DAY = 86_400_000;
/* Old enough that decay has visibly bitten, so the floors are what separate
   these memories rather than freshness. */
const KEPT_AT = NOW - 20 * DAY;

function memory(id: string): Inspiration {
  return {
    id,
    preview: `something I kept, ${id}`,
    isPublic: false,
    kind: "note",
    source: "app",
    capturedMs: KEPT_AT,
    updatedMs: KEPT_AT,
    attachments: [],
    reflectionCount: 0,
  };
}

function pattern(id: string): Signal {
  return {
    id,
    statement: `the pattern called ${id}`,
    status: "active",
    confidence: 60,
    evidenceCount: 3,
    lastEvidenceMs: KEPT_AT,
    createdMs: KEPT_AT,
    locked: false,
    unsupported: false,
    sharedGroupIds: [],
  };
}

function cites(signalId: string, inspirationId: string): Evidence {
  return {
    signalId,
    inspirationId,
    preview: "",
    quote: null,
    quoteSource: null,
    reason: null,
    createdMs: KEPT_AT,
  };
}

/** The light of one memory, given what stands on it. */
function litBy(input: {
  id: string;
  citingSignalIds: string[];
  posterSignalIds?: string[];
  principleSignalIds?: string[];
}): number {
  const citations = new Map<string, Evidence[]>([
    [input.id, input.citingSignalIds.map((s) => cites(s, input.id))],
  ]);
  const signals = new Map(input.citingSignalIds.map((s) => [s, pattern(s)] as const));
  const ball = makeBall(
    seedOf(
      memory(input.id),
      citations,
      signals,
      new Set(input.posterSignalIds ?? []),
      new Set(input.principleSignalIds ?? []),
    ),
  );
  colorBall(ball, NOW);
  return ball.alive;
}

describe("the carry: how much of a person a memory holds up", () => {
  it("derives the three facts from the citation index and the layers above it", () => {
    const citations = new Map<string, Evidence[]>([
      ["mem-1", [cites("sig-a", "mem-1"), cites("sig-b", "mem-1")]],
    ]);
    const signals = new Map([
      ["sig-a", pattern("sig-a")],
      ["sig-b", pattern("sig-b")],
    ]);

    const above = skyOf(
      "mem-1",
      citations,
      signals,
      new Set(["sig-b"]),
      new Set(["sig-a"]),
    );
    expect(above.cited, "two patterns cite it").toBe(true);
    expect(above.roots, "the boolean, counted").toBe(2);
    expect(above.onPoster, "one of its patterns is on the live board").toBe(true);
    expect(above.underPrinciple, "and one is under a settled principle").toBe(true);

    const alone = skyOf("mem-1", citations, signals, new Set(), new Set());
    expect(alone.roots).toBe(2);
    expect(alone.onPoster, "nothing above it on the board").toBe(false);
    expect(alone.underPrinciple).toBe(false);

    const uncited = skyOf("mem-nobody", citations, signals, new Set(), new Set());
    expect(uncited.cited).toBe(false);
    expect(uncited.roots, "a memory nothing cites carries nothing").toBe(0);
  });

  it("counts only the patterns it can resolve — an invisible citation lights nothing", () => {
    /* A citation row whose pattern is not in hand (an old row, a partial
       load) must not brighten a memory for something nobody can see. */
    const citations = new Map<string, Evidence[]>([
      ["mem-1", [cites("sig-here", "mem-1"), cites("sig-missing", "mem-1")]],
    ]);
    const above = skyOf("mem-1", citations, new Map([["sig-here", pattern("sig-here")]]));
    expect(above.roots).toBe(1);
  });

  it("reads as nothing above when the layers are not in hand", () => {
    /* An agent's ground and a room's are built without the viewer's layer 3
       or 4. Absent must read as "nothing above", never as an error. */
    const citations = new Map<string, Evidence[]>([["mem-1", [cites("sig-a", "mem-1")]]]);
    const above = skyOf("mem-1", citations, new Map([["sig-a", pattern("sig-a")]]));
    expect(above.onPoster).toBe(false);
    expect(above.underPrinciple).toBe(false);
  });

  it("lights four same-aged memories in the order of what they hold up", () => {
    const nothing = litBy({ id: "m-none", citingSignalIds: [] });
    const oneRoot = litBy({ id: "m-one", citingSignalIds: ["s1"] });
    const manyRoots = litBy({ id: "m-many", citingSignalIds: ["s1", "s2", "s3"] });
    const onBoard = litBy({
      id: "m-board",
      citingSignalIds: ["s1", "s2", "s3"],
      posterSignalIds: ["s1"],
    });
    const settled = litBy({
      id: "m-settled",
      citingSignalIds: ["s1", "s2", "s3"],
      posterSignalIds: ["s1"],
      principleSignalIds: ["s2"],
    });

    /* THE GRADIENT, and the reason this is `<` and never `<=`: the whole
       complaint was that these were equal. */
    expect(nothing).toBeLessThan(oneRoot);
    expect(oneRoot, "a memory three patterns rest on is not lit like one").toBeLessThan(
      manyRoots,
    );
    expect(manyRoots, "reaching what currently matters shows").toBeLessThan(onBoard);
    expect(onBoard, "and reaching something settled shows again").toBeLessThan(settled);

    /* Being cited at all still means "cannot rot": the floor is intact under
       the gradient, and the brightest is not saturated to white either. */
    expect(oneRoot).toBeGreaterThan(nothing);
    expect(settled).toBeLessThanOrEqual(1);
  });

  it("keeps the carry a clean nought-to-one, saturating where the doc says", () => {
    expect(
      carryOf({ roots: 0, promotion: 0, onPoster: false, underPrinciple: false }),
    ).toBe(0);
    expect(
      carryOf({
        roots: FIELD_CARRY_ROOT_SATURATION,
        promotion: 1,
        onPoster: true,
        underPrinciple: true,
      }),
      "the four shares sum to one, so full carry is exactly one",
    ).toBeCloseTo(1, 10);
    expect(
      FIELD_CARRY_ROOTS_SHARE +
        FIELD_CARRY_PROMOTED_SHARE +
        FIELD_CARRY_POSTER_SHARE +
        FIELD_CARRY_PRINCIPLE_SHARE,
    ).toBeCloseTo(1, 10);
    expect(
      carryOf({ roots: 99, promotion: 0, onPoster: false, underPrinciple: false }),
      "roots stop adding past the saturation — a memory is not a scoreboard",
    ).toBeCloseTo(
      carryOf({
        roots: FIELD_CARRY_ROOT_SATURATION,
        promotion: 0,
        onPoster: false,
        underPrinciple: false,
      }),
      10,
    );
  });
  it("bands a SAME-DAY archive by use — the young field is not one flat top band", () => {
    /* The founder's complaint, verbatim twice: "still all same brightness."
       Their archive was kept this week, so decay sat at one for every orb,
       the max clamped everything to full, and no amount of carry could show
       through — the first banding fix rescued old archives and left young
       ones saturated from the other end. This case is that field: everything
       kept TODAY, differing only in what stands on it. This was asserted at
       the sprite TIER the orb was drawn from, because alive values inside one
       band rendered as the founder's flat grey; the orbs and their bands are
       gone, so it is asserted on `alive`, the light itself. */
    const freshLit = (input: {
      id: string;
      citingSignalIds: string[];
      promoted?: boolean;
      posterSignalIds?: string[];
      principleSignalIds?: string[];
    }) => {
      const citations = new Map<string, Evidence[]>([
        [input.id, input.citingSignalIds.map((sig) => cites(sig, input.id))],
      ]);
      const signals = new Map(
        input.citingSignalIds.map(
          (sig) =>
            [
              sig,
              {
                ...pattern(sig),
                status: (input.promoted ? "active" : "emerging") as Signal["status"],
                /* AND THE EVIDENCE WITH IT. This flipped the status alone and
                   left `pattern()`'s three pieces of evidence in place, so
                   the "guess" was a candidate three memories deep wearing an
                   emerging label — and once the promotion term graded off the
                   evidence rather than the label, the guess and the confirmed
                   pattern came out identical. A fixture that contradicts
                   itself will happily prove the thing it contradicts. */
                evidenceCount: input.promoted ? FIELD_CARRY_PROMOTION_EVIDENCE : 1,
              },
            ] as const,
        ),
      );
      const ball = makeBall(
        seedOf(
          { ...memory(input.id), capturedMs: NOW, updatedMs: NOW },
          citations,
          signals,
          new Set(input.posterSignalIds ?? []),
          new Set(input.principleSignalIds ?? []),
        ),
      );
      colorBall(ball, NOW);
      return ball.alive;
    };

    const nothing = freshLit({ id: "f-none", citingSignalIds: [] });
    /* ONE root, EMERGING — the shape of nearly every memory in a real first
       week, and the case that was uniform: each capture derives its own lone
       candidate, nothing is adopted, no principles exist. */
    const guess = freshLit({ id: "f-guess", citingSignalIds: ["s1"], promoted: false });
    /* one root, but the pattern PROMOTED — three memories said the same
       thing. The only distinction a young archive has, and the one that has
       to move the light or the founder sees thirty identical orbs. */
    const confirmed = freshLit({ id: "f-conf", citingSignalIds: ["s1"], promoted: true });
    const settled = freshLit({
      id: "f-settled",
      citingSignalIds: ["s1", "s2", "s3"],
      promoted: true,
      posterSignalIds: ["s1"],
      principleSignalIds: ["s2"],
    });

    expect(guess, "a cited memory must be a visibly different BAND, same day").toBeGreaterThan(
      nothing,
    );
    expect(
      confirmed,
      "and holding up a CONFIRMED pattern outshines holding up a guess",
    ).toBeGreaterThan(guess);
    expect(settled, "and what reaches the poster and a principle sits above that").toBeGreaterThan(
      confirmed,
    );
  });

  it("bands an AGED archive by how far the pattern above each memory has got", () => {
    /* THE HOLE EVERY OTHER CASE IN THIS FILE LEFT OPEN, and the founder was
       standing in it.

       The same-day case above asserts tiers, but only across the
       promoted/poster/principle boundaries. The aged case asserts the twenty
       day archive, but reads `ball.alive` — so it green-lights exactly the
       differences that are too small to cross a band and therefore cannot be
       seen. Between them sat the actual population of a real archive: cited
       memories, none adopted, no principles, every candidate still emerging,
       differing only in HOW MUCH EVIDENCE has gathered under it. Running the
       real modules over the repo's own fixture, thirteen of fourteen such
       memories — nine to ninety-one days old — landed on one identical
       aliveness.

       So: same age, same everything, one emerging candidate each, and the
       light must climb with the evidence behind it. (It was the drawn TIER
       while orbs were drawn from banded sprites; with the orbs gone it is
       `alive`, strictly.) */
    const byEvidence = (id: string, evidenceCount: number) => {
      const citations = new Map<string, Evidence[]>([[id, [cites("s1", id)]]]);
      const signals = new Map([
        [
          "s1",
          {
            ...pattern("s1"),
            status: "emerging" as Signal["status"],
            evidenceCount,
          },
        ],
      ]);
      const ball = makeBall(seedOf(memory(id), citations, signals, new Set(), new Set()));
      colorBall(ball, NOW);
      return ball.alive;
    };

    const tiers = [1, 2, FIELD_CARRY_PROMOTION_EVIDENCE].map((n) =>
      byEvidence(`aged-${n}`, n),
    );
    for (let i = 1; i < tiers.length; i += 1) {
      expect(
        tiers[i],
        `evidence ${i + 1} must be brighter than evidence ${i}`,
      ).toBeGreaterThan(tiers[i - 1]);
    }
  });

  it("never lets age go silent — the passage of time is the one job it has", () => {
    /* `Math.max(recency, tended)` made this exactly zero. Freshness can only
       reach `FIELD_RECENCY_WEIGHT`; the cited floor is most of the way there
       already; so past about five days the max returned the floor and a
       cited memory's age stopped mattering FOREVER. Same carry, same
       everything, four ages: the light has to fall, every time, not merely
       eventually. */
    const atAge = (days: number) => {
      const id = `age-${days}`;
      const kept = NOW - days * DAY;
      const citations = new Map<string, Evidence[]>([[id, [cites("s1", id)]]]);
      const signals = new Map([["s1", pattern("s1")]]);
      const ball = makeBall(
        seedOf(
          { ...memory(id), capturedMs: kept, updatedMs: kept },
          citations,
          signals,
          new Set(),
          new Set(),
        ),
      );
      colorBall(ball, NOW);
      return ball.alive;
    };

    const ages = [0, 7, 20, 90].map(atAge);
    for (let i = 1; i < ages.length; i += 1) {
      expect(
        ages[i],
        `a cited memory ${[0, 7, 20, 90][i]} days old must be dimmer than one ${[0, 7, 20, 90][i - 1]} days old`,
      ).toBeLessThan(ages[i - 1]);
    }
  });
});
