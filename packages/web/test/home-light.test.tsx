// @vitest-environment jsdom

/**
 * WHAT YOU BUILT ON DOES NOT ROT — INCLUDING WHEN THE SKY IS SLOW.
 *
 * "Light is the only meaning channel" is the first of this codebase's declared
 * laws, and a memory a pattern rests on is supposed to have a floor under it
 * (`FIELD_FLOOR_CITED`) and a lift above it (`FIELD_CITED_LIFT`) so it cannot
 * sink to dark like an untended one. That fact does not arrive with the memory.
 * It arrives with the SKY's lightweight membership metadata in `loadSignals`.
 * Full signal evidence is now loaded only for a visible reading. On a real
 * page load the membership read can still land
 * after the archive, the agents and the walls have settled — which is after the
 * field was poured, and the pour is what bakes `hasNotes` into a ball.
 *
 * So the whole bug lives in WHEN, and a test that lets both requests resolve in
 * the same microtask cannot see it: the sky is already in hand when the last
 * pour runs and every orb comes out correctly lit. `sky.arrived` below is the
 * network, made exact — the membership request is held open until the case says
 * otherwise, which is the only difference between the two cases here.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The three seams are the ones
 * `home-field.test.tsx` explains at length; only the first is this file's
 * subject.
 *
 *   `lib/data` — the seam for the three layers, and `loadSignals` /
 *   `loadSignal` are overridden HERE rather than in `dataMockFrom`. That is
 *   the choice `home-sky.test.tsx` already made and its reason holds for this
 *   file too: the field's own suites want an empty sky, and a shared helper
 *   that quietly filled one would change what they measure. The audit that
 *   found this bug suggested widening the helper instead; the helper is shared
 *   and the timing is not, so it stays local.
 *
 *   `lib/api` — the group reads, which have no loader above them. There are no
 *   groups in these facts: a room's memories stand on the room's own wall and
 *   the camera never leaves the viewer's, so a room would add walls to the axis
 *   and nothing to the ground under test.
 *
 *   `lib/auth-context` — the session stated as a fact, because the page renders
 *   for a signed-out visitor too and that is a different world.
 *
 *   `helpers/canvas-stub` and `helpers/render-home` — the canvas, the clock,
 *   the frame loop, the viewport and `Math.random`: the parts of a browser a
 *   test cannot have for real. The clock matters more here than anywhere,
 *   because this file's whole subject is the ORDER two things happened in.
 *   The simulation itself is NOT replaced: the shipped effects, the shipped
 *   pour and the shipped activation rules run here, which is the only reason
 *   a number read off the audit means anything.
 *
 * WHAT IT DOES NOT CHECK is appearance. The canvas here draws nothing, so
 * `alive` is read as the number the activation rules produced, never as a
 * pixel — the same rule every file beside this one obeys.
 */
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  carryOf,
  FIELD_CARRY_PROMOTION_EVIDENCE,
  FIELD_CARRY_SPAN,
  FIELD_DECAY_HALF_LIFE_DAYS,
  FIELD_FLOOR_CITED,
  FIELD_RECENCY_WEIGHT,
} from "../src/lib/aliveness";
import { installCanvasStub, setViewport } from "./helpers/canvas-stub";
import {
  apiMockFrom,
  dataMockFrom,
  mountWorld,
  VIEWER_ID,
  type MountedWorld,
} from "./helpers/render-home";

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 7, 16);

/**
 * THE SECOND REQUEST, HELD OPEN.
 *
 * Hoisted with the `vi.mock` factory that reads it, because `vi.mock` is
 * lifted above every other statement in the file and a plain `const` here
 * would not exist yet when the factory runs — the same reason `home-sky`
 * hoists its record of writes.
 *
 * `reset()` is per-case rather than per-file: a promise can only be resolved
 * once, so without it the second mount would find the gate already open and
 * the case that needs a slow network would silently get a fast one.
 */
const sky = vi.hoisted(() => {
  let open: () => void = () => {};
  const gate = {
    arrived: Promise.resolve(),
    land: () => open(),
    reset: () => {
      gate.arrived = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
  };
  return gate;
});

/** The one memory a pattern rests on. Its neighbours rest under nothing. */
const CITED = "own-0";

/**
 * Four memories, all a month old, so decay alone leaves every one of them near
 * dark (0.5^(29/7) ≈ 0.06). That gap is the instrument: anything above
 * `FIELD_FLOOR_CITED` in this world can only have come from a citation, so the
 * assertions below never have to separate "lit because cited" from "lit because
 * recent".
 */
const FACTS = {
  inspirations: [28, 29, 30, 31].map((daysAgo, i) => ({
    id: `own-${i}`,
    text: `something I kept, ${i}`,
    daysAgo,
  })),
  groups: [],
};

const SIGNAL = {
  id: "signal-naming",
  statement: "You keep coming back to how things are named.",
};

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, ...apiMockFrom(FACTS) };
});

vi.mock("../src/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/data")>();
  const row = {
    id: SIGNAL.id,
    inspirationIds:[CITED],
    statement: SIGNAL.statement,
    /* `emerging` is a pattern still forming overhead — the ordinary state for
       something derived in the background while the page is open. */
    status: "emerging" as const,
    confidence: 60,
    evidenceCount: 1,
    lastEvidenceMs: BASE - DAY,
    createdMs: BASE - 40 * DAY,
    locked: false,
    unsupported: false,
    sharedGroupIds: [],
  };
  return {
    ...actual,
    ...dataMockFrom(FACTS),
    loadSignals: async () => {await sky.arrived;return [row];},
    loadSignal: async (id: string) => {
      if (id !== SIGNAL.id) throw new Error(`no such signal ${id}`);
      /* THE NETWORK, MADE EXACT — see the gate above. */
      await sky.arrived;
      return {
        ...row,
        evidence: [
          {
            signalId: SIGNAL.id,
            inspirationId: CITED,
            preview: "something I kept, 0",
            quote: "the words that carried it",
            reason: null,
            createdMs: BASE - DAY,
          },
        ],
      };
    },
  };
});

vi.mock("../src/lib/auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth-context")>();
  const session = {
    status: "authenticated",
    account: { id: "account-1", email: "you@example.test" },
    profile: { id: VIEWER_ID, name: "You", type: "human" },
    profiles: [],
    refresh: async () => undefined,
    signOut: async () => undefined,
  };
  return { ...actual, useOptionalAuth: () => session, useAuth: () => session };
});

let layout: MountedWorld;

beforeAll(() => {
  installCanvasStub();
  setViewport(1280, 900);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  layout?.unmount();
});

/**
 * What THIS cited memory's light comes to: its floor, what age still adds on
 * top of that floor, and what it carries.
 *
 * Every term is the fixture stated honestly rather than decoration. One
 * pattern rests on this memory; it is on no board and under no principle; and
 * it is still emerging with a single piece of evidence, so it has got exactly
 * one third of the way to the promotion the loop grades against. The freshest
 * of the four memories is the one `aliveMax` reports, so the decay is read off
 * that one. Written as the expression rather than as a number so that the day
 * a share is retuned this test moves with the product instead of failing for a
 * reason that has nothing to do with what it is watching.
 *
 * The age term used to be absent here, and correctly so: `colorBall` took the
 * MAX of freshness and the floors, and at four weeks the floor won outright.
 * It is additive now — a cited memory's age had otherwise stopped mattering
 * forever past about five days — so it appears in the arithmetic too.
 */
const FRESHEST_DAYS = Math.min(...FACTS.inspirations.map((i) => i.daysAgo));
/** The floor and the carry: every term that does not move with the clock. */
const CITED_LIGHT =
  FIELD_FLOOR_CITED +
  FIELD_CARRY_SPAN *
    carryOf({
      roots: 1,
      promotion: 1 / FIELD_CARRY_PROMOTION_EVIDENCE,
      onPoster: false,
      underPrinciple: false,
    });
/**
 * And the most that age can still add on top of it.
 *
 * `BASE` is a fixed date; the loop colours the ball against the real clock. So
 * the memories are AT LEAST `FRESHEST_DAYS` old and get older every day this
 * suite is run, and the freshness term shrinks with them — which is why this
 * is a band and not an equality. It used to be an equality and it used to be
 * right, because `colorBall` took the max of freshness and the floors and at
 * four weeks the floor won outright: the clock could not reach the number.
 * Now that age is additive it can, and an equality here would have been a test
 * that failed on a Tuesday.
 *
 * The band is nowhere near loose enough to let the bug back through: an
 * UNCITED memory of this age lights at under a hundredth, and the floor alone
 * is thirty times that.
 */
const CITED_CEILING =
  CITED_LIGHT +
  (1 - FIELD_FLOOR_CITED) *
    FIELD_RECENCY_WEIGHT *
    Math.pow(0.5, FRESHEST_DAYS / FIELD_DECAY_HALF_LIFE_DAYS);

describe("a memory a pattern rests on", () => {
  /**
   * THE REGRESSION, AS A TEST.
   *
   * The effect that builds the ball list reads `citations` and `signals` and
   * depends on neither, so nothing re-ran when the sky finally landed and every
   * load-bearing memory decayed as if nothing rested on it. It recovered by
   * accident on any later change to the agents or the walls — travelling to a
   * room, or a long absence from the tab — which is why it read as "the field
   * is dim until I wander around" rather than as a bug.
   */
  it("is lit when the sky lands after the ground was poured", async () => {
    sky.reset();
    layout = await mountWorld(FACTS);
    await layout.toField();

    const before = layout.audit();
    expect(before.present, "nothing is standing in the ground at all").toBeGreaterThan(0);
    expect(
      before.drawn.aliveMax,
      "a month-old memory is already lit before anything cites it — the world " +
        "under test is not the one these assertions describe",
    ).toBeLessThan(FIELD_FLOOR_CITED);

    await act(async () => {
      sky.land();
      /* a macrotask, so the whole chain behind the request runs: the evidence
         resolves, the index is built, and the page sets it */
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await layout.step(5);

    expect(
      layout.audit().drawn.aliveMax,
      "the citation never reached the orb: a memory a pattern rests on is " +
        "still decaying like an untended one",
    ).toBeGreaterThanOrEqual(CITED_LIGHT);
    expect(
      layout.audit().drawn.aliveMax,
      "and it is lit by the citation, not by some new source of light",
    ).toBeLessThanOrEqual(CITED_CEILING);
  });

  /**
   * The same world with the sky already in hand when the ground is poured.
   * This case passed before the fix and has to keep passing after it: the pour
   * is still where a ball's light comes from, and re-lighting afterwards must
   * not be the ONLY path that works.
   */
  it("is lit when the sky was already in hand", async () => {
    sky.land();
    layout = await mountWorld(FACTS);
    await layout.toField();

    expect(
      layout.audit().drawn.aliveMax,
      "the pour itself no longer reads the sky",
    ).toBeGreaterThanOrEqual(CITED_LIGHT);
    expect(
      layout.audit().drawn.aliveMax,
      "and it is lit by the citation, not by some new source of light",
    ).toBeLessThanOrEqual(CITED_CEILING);
  });
});
