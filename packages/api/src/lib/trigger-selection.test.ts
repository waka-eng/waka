import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "../scoring/wow-score.js";

/**
 * Trigger selection, judged on group shapes the real boards are not.
 *
 * Every constant in this pipeline was arrived at by looking at one group of
 * six colleagues who save very similar material. That group is not the product
 * — the product is whatever combinations people make next, and those will be
 * tighter, looser, larger and smaller than anything we have looked at.
 *
 * So these cases are synthetic on purpose. They fix the *properties* selection
 * must have for any group, rather than the numbers one board happens to
 * produce: everyone gets asked, the pass does not spend all its turns inside a
 * single cluster, and a group that genuinely shares little is not shredded in
 * the name of diversity it never had.
 *
 * They exercise the scoring rule directly rather than the DB-bound loader, so
 * they run without a database and cannot drift from what production computes
 * only if that rule stays in one place — which it does, below, mirrored from
 * `loadTriggerSignals`.
 */

type Signal = { id: string; userId: string; embedding: number[] };

const TRIGGER_DIVERSITY_WEIGHT = 0.6;

/** A deterministic unit vector pointing in a named direction, with jitter. */
function vector(theme: number, jitter: number): number[] {
  const base = Array.from({ length: 8 }, (_, i) => (i === theme ? 1 : 0));
  return base.map((value, i) => value + (i === (theme + 1) % 8 ? jitter : 0));
}

function baselineOf(signals: Signal[]): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i + 1; j < signals.length; j += 1) {
      total += cosineSimilarity(signals[i]!.embedding, signals[j]!.embedding);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

/**
 * The production rule, mirrored: round-robin for fairness, and within a
 * member's turn the signal that reaches furthest while adding most.
 */
function selectTriggers(signals: Signal[], perMemberCap: number, maxTriggers: number): Signal[] {
  const reach = new Map<string, number>();
  for (const signal of signals) {
    let best = -1;
    for (const other of signals) {
      if (other.userId === signal.userId) continue;
      const score = cosineSimilarity(signal.embedding, other.embedding);
      if (score > best) best = score;
    }
    reach.set(signal.id, best < 0 ? 0 : best);
  }

  const baseline = baselineOf(signals);
  const redundancy = (similarity: number) => {
    if (similarity <= baseline) return 0;
    const headroom = 1 - baseline;
    return headroom <= 0 ? 0 : (similarity - baseline) / headroom;
  };

  const members = [...new Set(signals.map((signal) => signal.userId))].sort();
  // Ranked, not truncated: the cap applies to what is TAKEN, not to what may
  // be considered, or the diversity pass only ever sees the centre.
  const buckets = members.map((userId) =>
    signals
      .filter((signal) => signal.userId === userId)
      .sort((a, b) => (reach.get(b.id) ?? 0) - (reach.get(a.id) ?? 0)),
  );

  const out: Signal[] = [];
  const taken: number[][] = [];
  const takenPerMember = new Map<string, number>();
  while (out.length < maxTriggers) {
    let advanced = false;
    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      const owner = bucket[0]!.userId;
      if ((takenPerMember.get(owner) ?? 0) >= perMemberCap) continue;
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < bucket.length; i += 1) {
        const candidate = bucket[i]!;
        let closest = 0;
        for (const chosen of taken) {
          const score = cosineSimilarity(candidate.embedding, chosen);
          if (score > closest) closest = score;
        }
        const score = (reach.get(candidate.id) ?? 0) - TRIGGER_DIVERSITY_WEIGHT * redundancy(closest);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      const [chosen] = bucket.splice(bestIndex, 1);
      if (!chosen) continue;
      out.push(chosen);
      takenPerMember.set(chosen.userId, (takenPerMember.get(chosen.userId) ?? 0) + 1);
      taken.push(chosen.embedding);
      advanced = true;
      if (out.length >= maxTriggers) break;
    }
    if (!advanced) break;
  }
  return out;
}

const spread = (signals: Signal[]) => baselineOf(signals);

describe("a group with more than one thing to say", () => {
  /**
   * Two shared themes, one bigger than the other, each spanning members.
   *
   * This is the shape that matters, and it took two wrong fixtures to see it.
   * A signal no other member relates to cannot make a group note at all — a
   * note needs two hearts — so "pick the eccentric ones" is not the property
   * to want. The property is that a pass with two real themes available
   * spends turns on BOTH, instead of pouring every trigger into the larger
   * one and returning five phrasings of it. That is what a real board did.
   */
  const twoThemes: Signal[] = [];
  for (let m = 0; m < 4; m += 1) {
    // The dominant theme: everyone, several saves each.
    for (let s = 0; s < 5; s += 1) {
      twoThemes.push({ id: `big-${m}-${s}`, userId: `u${m}`, embedding: vector(0, s * 0.03 + m * 0.01) });
    }
    // A second real theme: fewer saves, still shared across members.
    for (let s = 0; s < 2; s += 1) {
      twoThemes.push({ id: `alt-${m}-${s}`, userId: `u${m}`, embedding: vector(4, s * 0.03 + m * 0.01) });
    }
  }

  it("asks every member", () => {
    const chosen = selectTriggers(twoThemes, 4, 16);
    expect(new Set(chosen.map((signal) => signal.userId)).size).toBe(4);
  });

  it("gives the smaller theme roughly its share of the turns", () => {
    // The bar is set where the diversity term is actually load-bearing.
    // Measured with the term switched off, the smaller theme gets 2 of 16
    // turns; with it, 5. Asserting merely "more than zero" would pass either
    // way and test nothing. The smaller theme is 2 of every 7 saves, so ~4 of
    // 16 is its share.
    const chosen = selectTriggers(twoThemes, 4, 16);
    const fromAlt = chosen.filter((signal) => signal.id.startsWith("alt-")).length;
    expect(fromAlt).toBeGreaterThanOrEqual(4);
  });

  it("does not let the dominant theme take every turn", () => {
    // Pure reach-ranking gives the big cluster all of them, because everything
    // in it reaches everyone. That is the collapse mechanism, in one line.
    const chosen = selectTriggers(twoThemes, 4, 16);
    const fromBig = chosen.filter((signal) => signal.id.startsWith("big-")).length;
    expect(fromBig).toBeLessThan(chosen.length);
  });
});

describe("a group of people who share almost nothing yet", () => {
  // Each member lives in a different theme — two strangers, a new room, the
  // shape the product must survive to ever grow past people who already know
  // each other.
  const loose: Signal[] = [];
  for (let m = 0; m < 4; m += 1) {
    for (let s = 0; s < 4; s += 1) {
      loose.push({ id: `l-${m}-${s}`, userId: `u${m}`, embedding: vector(m, s * 0.05) });
    }
  }

  it("still asks every member", () => {
    const chosen = selectTriggers(loose, 4, 16);
    expect(new Set(chosen.map((signal) => signal.userId)).size).toBe(4);
  });

  it("does not shred a group for diversity it never had", () => {
    // With little shared ground, the reach signal is what finds the few real
    // bridges. A diversity rule measured on absolutes would override it here
    // and pick whatever is most eccentric; measured against this group's own
    // spread, it barely applies.
    const chosen = selectTriggers(loose, 4, 16);
    expect(spread(chosen)).toBeGreaterThan(baselineOf(loose) - 0.15);
  });
});

describe("shapes the current constants were never chosen for", () => {
  it("a two-person room with a handful of saves each still asks both", () => {
    const pair: Signal[] = [
      { id: "a1", userId: "a", embedding: vector(0, 0) },
      { id: "a2", userId: "a", embedding: vector(1, 0.1) },
      { id: "b1", userId: "b", embedding: vector(0, 0.05) },
      { id: "b2", userId: "b", embedding: vector(3, 0) },
    ];
    const chosen = selectTriggers(pair, 8, 24);
    expect(new Set(chosen.map((signal) => signal.userId)).size).toBe(2);
    // It must not invent triggers it does not have.
    expect(chosen).toHaveLength(4);
  });

  it("a twenty-person room reaches everyone before it runs out of budget", () => {
    // MAX_TRIGGERS is a flat 24 today, so twenty members get one turn each and
    // members past the budget get none at all. This pins the property that
    // matters — nobody is structurally unaskable — so the fix in
    // `combination-as-an-act` (budgets that scale with hearts) has a test
    // waiting for it.
    const crowd: Signal[] = [];
    for (let m = 0; m < 20; m += 1) {
      for (let s = 0; s < 3; s += 1) {
        crowd.push({ id: `c-${m}-${s}`, userId: `u${m}`, embedding: vector(m % 8, s * 0.07) });
      }
    }
    const chosen = selectTriggers(crowd, 8, 24);
    expect(new Set(chosen.map((signal) => signal.userId)).size).toBe(20);
  });

  it("a member who joined with one save is still asked", () => {
    const lopsided: Signal[] = [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `big-${i}`,
        userId: "prolific",
        embedding: vector(0, i * 0.03),
      })),
      { id: "new-1", userId: "newcomer", embedding: vector(2, 0) },
    ];
    const chosen = selectTriggers(lopsided, 8, 12);
    expect(chosen.some((signal) => signal.userId === "newcomer")).toBe(true);
  });
});
