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

import { makeBall, seedOf, makeGroupInspirationBall, groupInspirationViewId, type Inspiration } from "../src/space/inspiration/orb";

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

describe("the self wall's origin", () => {
  it('keeps one public capture distinct across personal and room scenes without changing its API identity', () => {
    const capture = { id: 'capture-1', text: 'Public words', kind: 'note' as const, source: 'app' as const,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ownerProfileId: 'owner', ownerName: 'Owner', ownerType: 'human' as const };
    const one = makeGroupInspirationBall(capture, { id: 'group-1', col: 1 }, 'owner');
    const two = makeGroupInspirationBall(capture, { id: 'group-2', col: 2 }, 'viewer');
    expect(new Set([capture.id, one.id, two.id]).size).toBe(3);
    expect(one.id).toBe(groupInspirationViewId('group-1', capture.id));
    expect(one).toMatchObject({ col: 1, own: true, sigId: capture.id, ownerProfileId: 'owner', authorName: 'Owner' });
    expect(two).toMatchObject({ col: 2, own: false, sigId: capture.id });
    expect(makeGroupInspirationBall(capture, { id: 'group-1', col: 1 }, 'owner').id).toBe(one.id);
  });
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
