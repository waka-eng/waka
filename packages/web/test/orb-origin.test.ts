/**
 * WHO CHOSE TO KEEP THIS — carried, never assumed.
 *
 * The self wall's balls hard-coded `origin: "human"` while the agent and
 * room walls carried the fact through, so the pre-ruling rows an agent
 * relayed into the human wall painted as if the person had kept them
 * (agent→human capture retired 2026-08-29; history stays and must render
 * as what it was). The lens is the only reader of this field, and the lens
 * fades rather than removes — so a wrong origin is a memory quietly wearing
 * the wrong keeper, forever.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing — `seedOf` and `makeBall` are
 * pure, and the claim is about the value they thread, not about the world.
 */
import { describe, expect, it } from "vitest";

import { makeBall, seedOf, type Inspiration } from "../src/space/inspiration/orb";

function inspiration(source: "app" | "agent"): Inspiration {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    preview: "kept once, painted honestly forever",
    isPublic: false,
    kind: "note",
    source,
    capturedMs: 1_700_000_000_000,
    updatedMs: 1_700_000_000_000,
    attachments: [],
    reflectionCount: 0,
  };
}

/* ONE CASE LEFT THIS FILE ON 2026-10-15: "keeps one public capture distinct
   across personal and room scenes without changing its API identity". It held
   the rule that a scene instance is not another API identifier — the same
   save standing on your wall and in two rooms had to be three objects with
   one `sigId` — and it tested it through `makeGroupInspirationBall` and
   `groupInspirationViewId`, which are deleted with rooms. The rule itself is
   written up in the tombstone those functions left behind in
   `space/inspiration/orb.ts`, because it will be true again the first time
   one memory has to appear in two places at once; there is simply nothing in
   the product that does so now, and a test that constructs its own subject
   to assert about would be testing the test. The three cases below are about
   `seedOf`/`makeBall` threading `origin`, which rooms never touched. */
describe("the self wall's origin", () => {
  it("paints an agent-kept row as the machine's, not the person's", () => {
    const seed = seedOf(inspiration("agent"), new Map(), new Map());
    expect(seed.origin).toBe("agent");
    expect(makeBall(seed).origin).toBe("agent");
  });

  it("paints the person's own words as theirs", () => {
    const seed = seedOf(inspiration("app"), new Map(), new Map());
    expect(seed.origin).toBe("human");
    expect(makeBall(seed).origin).toBe("human");
  });

  it("a seed that names no origin is the person's — what birth from the mouth is", () => {
    const seed = seedOf(inspiration("app"), new Map(), new Map());
    delete (seed as { origin?: string }).origin;
    expect(makeBall(seed).origin).toBe("human");
  });
});
