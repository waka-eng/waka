/**
 * The guarantees layer 3 makes in code rather than in a prompt.
 *
 * The live gate proves the artifact holds together over a real archive, but
 * it cannot prove the two things that matter most when the model misbehaves:
 * that a locked entry is reproduced from the stored row rather than from what
 * came back, and that a citation the profile does not hold never reaches the
 * database. Both are enforced here, so both are asserted here.
 */

import { describe, expect, it, vi } from "vitest";

import {
  assessShiftFloor,
  TOP_OF_MIND_MIN_SHIFT_HOURS,
  describeTimeShape,
  diversifyRanked,
  SELECTION_DIVERSITY_MAX_COSINE,
  assembleEntries,
  chooseSelection,
  SELECTION_DISPUTED_MULTIPLIER,
  TOP_OF_MIND_MIN_SIGNALS,
  TOP_OF_MIND_SIGNAL_LIMIT,
  computeComebackBonus,
  computeSelectionScore,
  countLockViolations,
  isUnchanged,
  validateSynthesizedEntries,
  type CarriedEntry,
} from "./top-of-mind-synthesis.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-15T12:00:00.000Z");

function carried(overrides: Partial<CarriedEntry> = {}): CarriedEntry {
  return {
    type: "pattern",
    body: "A generated observation.",
    belief: null,
    prompt: null,
    lockedAt: null,
    pinnedAt: null,
    dismissedAt: null,
    sortOrder: 0,
    citedSignalIds: [],
    ...overrides,
  };
}

describe("locked entries are reproduced from the stored row", () => {
  const locked = carried({
    body: "Keep only what I could rebuild in one evening.",
    lockedAt: new Date("2026-08-01T00:00:00.000Z"),
    sortOrder: 1,
  });

  it("carries a locked entry verbatim even when the model rewrote it", () => {
    const assembled = assembleEntries({
      carried: [locked],
      generated: [
        // The model's version of the same idea, reworded.
        { type: "pattern", body: "You prefer tools you can rebuild quickly.", citedSignalIds: [] },
      ],
    });

    const survivor = assembled.find((entry) => entry.body === locked.body);
    expect(survivor).toBeDefined();
    expect(survivor!.lockedAt).toEqual(locked.lockedAt);
  });

  it("carries it even when the model returned nothing at all", () => {
    const assembled = assembleEntries({ carried: [locked], generated: [] });
    expect(assembled.map((entry) => entry.body)).toContain(locked.body);
  });

  it("notices when the model failed to reproduce a locked entry", () => {
    expect(
      countLockViolations(
        [locked],
        [{ type: "pattern", body: "Something else entirely.", citedSignalIds: [] }],
      ),
    ).toBe(1);

    expect(
      countLockViolations([locked], [{ type: "pattern", body: locked.body, citedSignalIds: [] }]),
    ).toBe(0);
  });

  it("puts pinned entries first, then locked, and dismissed last", () => {
    const pinned = carried({ body: "Pinned.", pinnedAt: NOW, sortOrder: 5 });
    const dismissed = carried({ body: "Dismissed.", dismissedAt: NOW, sortOrder: 2 });

    const assembled = assembleEntries({
      carried: [dismissed, locked, pinned],
      generated: [{ type: "pattern", body: "Fresh.", citedSignalIds: [] }],
    });

    const bodies = assembled.map((entry) => entry.body);
    expect(bodies[0]).toBe("Pinned.");
    expect(bodies.indexOf(locked.body)).toBeLessThan(bodies.indexOf("Fresh."));
    expect(bodies[bodies.length - 1]).toBe("Dismissed.");
  });
});

describe('unresolved disputes do not publish as one-sided conclusions',()=>{
  it('does not introduce a stronger personal claim through the optional belief field',()=>{
    const input=[{type:'pattern' as const,body:'You try small experiments.',belief:'Small experiments always work for you.',citedSignalIds:['a']},
      {type:'pattern' as const,body:'You try small experiments.',belief:'You prefer a small trial before committing.',citedSignalIds:['a']},
      {type:'pattern' as const,body:'You try small experiments.',belief:'You try small experiments.',citedSignalIds:['a']}];
    const entries=validateSynthesizedEntries(input,new Set(['a']),new Map(),new Map([['a','You prefer a small trial before committing.']])).entries;
    expect(entries.map(row=>row.belief)).toEqual([undefined,'You prefer a small trial before committing.','You try small experiments.']);
    expect(entries.map(row=>row.body)).toEqual(input.map(row=>row.body));
  });
  const contested=new Map([['a',['b']],['b',['a']]]);
  it('requires a tension and both citations, and removes a separate settled belief',()=>{
    const entries=validateSynthesizedEntries([
      {type:'pattern',body:'A wins.',citedSignalIds:['a']},
      {type:'tension',body:'Only A.',citedSignalIds:['a']},
      {type:'tension',body:'A and B both pull.',belief:'A wins.',citedSignalIds:['a','b']},
      {type:'tension',body:'A and B pull differently.',citedSignalIds:['a','b']},
      {type:'pattern',body:'A separate supported interest.',citedSignalIds:['c']},
    ],new Set(['a','b','c']),contested).entries;
    expect(entries.map(row=>row.body)).toEqual(['A and B both pull.','A and B pull differently.','A separate supported interest.']);
    expect(entries[0]!.belief).toBeUndefined();
  });
  it('does not let a dropped foreign partner make a one-sided tension valid',()=>{
    expect(validateSynthesizedEntries([{type:'tension',body:'A vs foreign.',citedSignalIds:['a','foreign']}],
      new Set(['a','b']),contested).entries).toEqual([]);
  });
});

describe("citations are checked against what the profile holds", () => {
  const owned = new Set(["signal-a", "signal-b"]);
  it('identifies missing owned citations and unresolved disputes separately', () => {
    const rejected=vi.fn();
    const result=validateSynthesizedEntries([
      {type:'pattern',body:'Private words must not enter diagnostics.',citedSignalIds:['foreign']},
      {type:'tension',body:'Only one side.',citedSignalIds:['signal-a']},
    ],owned,new Map([['signal-a',['signal-b']]]),new Map(),rejected);
    expect(result.entries).toEqual([]);
    expect(rejected.mock.calls).toEqual([[0,'no_owned_citations'],[1,'unresolved_conflict']]);
  });

  it("keeps citations the profile owns", () => {
    const result = validateSynthesizedEntries(
      [{ type: "pattern", body: "Grounded.", citedSignalIds: ["signal-a", "signal-b"] }],
      owned,
    );

    expect(result.entries[0]!.citedSignalIds).toEqual(["signal-a", "signal-b"]);
    expect(result.droppedCitations).toBe(0);
  });

  /**
   * A hallucinated id would otherwise be written as a foreign key and fail the
   * insert, taking the whole refresh with it — one invented citation must not
   * cost someone their regeneration.
   */
  it("drops an invented citation rather than writing it", () => {
    const result = validateSynthesizedEntries(
      [{ type: "pattern", body: "Half-grounded.", citedSignalIds: ["signal-a", "signal-zzz"] }],
      owned,
    );

    expect(result.entries[0]!.citedSignalIds).toEqual(["signal-a"]);
    expect(result.droppedCitations).toBe(1);
  });
});

describe("a pass that changed nothing is recognisable as such", () => {
  const previous = [
    carried({ body: "First.", sortOrder: 0, citedSignalIds: ["a"] }),
    carried({ body: "Second.", sortOrder: 1, citedSignalIds: ["b"] }),
  ];

  const persisted = (entries: CarriedEntry[]) =>
    entries.map((entry) => ({
      type: entry.type,
      body: entry.body,
      belief: entry.belief,
      prompt: entry.prompt,
      lockedAt: entry.lockedAt,
      pinnedAt: entry.pinnedAt,
      dismissedAt: entry.dismissedAt,
      citedSignalIds: entry.citedSignalIds,
    }));

  it("is unchanged when the same entries come back in the same order", () => {
    expect(isUnchanged(previous, persisted(previous))).toBe(true);
  });

  it("is changed when a body moves", () => {
    const next = persisted(previous);
    next[1] = { ...next[1]!, body: "Second, reworded." };
    expect(isUnchanged(previous, next)).toBe(false);
  });

  it("is changed when the citations move, even with identical text", () => {
    const next = persisted(previous);
    next[0] = { ...next[0]!, citedSignalIds: ["a", "c"] };
    expect(isUnchanged(previous, next)).toBe(false);
  });

  it("is changed when an entry appears or disappears", () => {
    expect(isUnchanged(previous, persisted(previous).slice(0, 1))).toBe(false);
  });

  /** Dismissed entries ride along only so the dismissal survives. */
  it("ignores dismissed entries on both sides", () => {
    const withDismissed = [...previous, carried({ body: "Gone.", dismissedAt: NOW, sortOrder: 9 })];
    expect(isUnchanged(withDismissed, persisted(previous))).toBe(true);
  });
});

describe("selection favours what returned after a silence", () => {
  it("gives nothing for a signal that never went quiet", () => {
    const steady = [
      new Date(NOW.getTime() - 3 * DAY),
      new Date(NOW.getTime() - 2 * DAY),
      new Date(NOW.getTime() - DAY),
    ];
    expect(computeComebackBonus(steady, NOW)).toBe(0);
  });

  /**
   * Surviving a silence is the strongest evidence a capture log can produce
   * that an interest is durable rather than a hot week.
   */
  it("rewards a signal that came back after months of quiet", () => {
    const returned = [
      new Date(NOW.getTime() - 120 * DAY),
      new Date(NOW.getTime() - 110 * DAY),
      new Date(NOW.getTime() - 2 * DAY),
    ];
    expect(computeComebackBonus(returned, NOW)).toBeGreaterThan(0);
  });

  it("gives nothing for a comeback nobody has touched since", () => {
    const staleReturn = [
      new Date(NOW.getTime() - 200 * DAY),
      new Date(NOW.getTime() - 60 * DAY),
    ];
    expect(computeComebackBonus(staleReturn, NOW)).toBe(0);
  });

  it("ranks a confident, well-evidenced, recent signal above a thin one", () => {
    const strong = computeSelectionScore({
      confidence: 90,
      evidenceCount: 6,
      lastEvidenceAt: new Date(NOW.getTime() - DAY),
      comebackBonus: 0,
      now: NOW,
    });
    const thin = computeSelectionScore({
      confidence: 20,
      evidenceCount: 1,
      lastEvidenceAt: new Date(NOW.getTime() - 90 * DAY),
      comebackBonus: 0,
      now: NOW,
    });
    expect(strong).toBeGreaterThan(thin);
  });
});

describe("selection listens to the owner's verdicts", () => {
  const base = {
    confidence: 80,
    evidenceCount: 5,
    lastEvidenceAt: new Date(NOW.getTime() - DAY),
    comebackBonus: 0,
    now: NOW,
  };

  /**
   * A multiplier rather than an exclusion: the person may be wrong, the
   * pattern may return with new evidence, and a memory that silently drops
   * whatever was disputed cannot be argued with.
   */
  it("dampens a disputed signal without banishing it", () => {
    const trusted = computeSelectionScore(base);
    const disputed = computeSelectionScore({ ...base, disputed: true });

    expect(disputed).toBeGreaterThan(0);
    expect(disputed).toBeCloseTo(trusted * SELECTION_DISPUTED_MULTIPLIER, 5);
  });

  it("still lets a strong disputed signal outrank a weak trusted one", () => {
    const strongDisputed = computeSelectionScore({ ...base, disputed: true });
    const weakTrusted = computeSelectionScore({
      confidence: 10,
      evidenceCount: 1,
      lastEvidenceAt: new Date(NOW.getTime() - 120 * DAY),
      comebackBonus: 0,
      now: NOW,
    });
    expect(strongDisputed).toBeGreaterThan(weakTrusted);
  });
});

describe("cold start: the artifact appears before patterns have recurred", () => {
  const a = (n: number) => Array.from({ length: n }, (_, i) => `active-${i}`);
  const e = (n: number) => Array.from({ length: n }, (_, i) => `emerging-${i}`);

  it("borrows forming signals when there are no durable ones yet", () => {
    const chosen = chooseSelection([], e(5));
    expect(chosen.provisional).toBe(true);
    expect(chosen.signals).toHaveLength(TOP_OF_MIND_MIN_SIGNALS);
    expect(chosen.signals.every((id) => id.startsWith("emerging"))).toBe(true);
  });

  it("tops a thin active set up to the floor with forming signals, active first", () => {
    const chosen = chooseSelection(a(1), e(5));
    expect(chosen.provisional).toBe(true);
    expect(chosen.signals).toHaveLength(TOP_OF_MIND_MIN_SIGNALS);
    expect(chosen.signals[0]).toBe("active-0");
  });

  it("uses durable signals alone when no qualified recent focus is supplied", () => {
    const chosen = chooseSelection(a(TOP_OF_MIND_MIN_SIGNALS), e(20));
    expect(chosen.provisional).toBe(false);
    expect(chosen.signals.every((id) => id.startsWith("active"))).toBe(true);
  });

  it("caps a large durable set at the signal limit", () => {
    const chosen = chooseSelection(a(50), e(0));
    expect(chosen.signals).toHaveLength(TOP_OF_MIND_SIGNAL_LIMIT);
    expect(chosen.provisional).toBe(false);
  });

  it("stays empty when the profile has nothing", () => {
    expect(chooseSelection([], [])).toEqual({ signals: [], provisional: false });
  });

  it('reserves a bounded lead for qualified current focus without duplicating active rows',()=>{
    const active=a(20),emerging=e(3);
    const chosen=chooseSelection(active,emerging,[emerging[0]!,active[5]!,active[7]!,emerging[1]!]);
    expect(chosen.signals.slice(0,3)).toEqual([emerging[0],active[5],active[7]]);
    expect(chosen.signals).toHaveLength(TOP_OF_MIND_SIGNAL_LIMIT);
    expect(new Set(chosen.signals).size).toBe(TOP_OF_MIND_SIGNAL_LIMIT);
    expect(chosen.provisional).toBe(true);
  });
});


describe("describeTimeShape — a pattern's life, worded for the synthesis", () => {
  const NOW = new Date("2026-08-31T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  it("no evidence is no shape", () => {
    expect(describeTimeShape([], NOW)).toBeNull();
  });

  it("names the arrival", () => {
    expect(describeTimeShape([daysAgo(2)], NOW)).toBe("new this week");
  });

  it("names the return — the gap, not the age, is the story", () => {
    const shape = describeTimeShape([daysAgo(120), daysAgo(80), daysAgo(3)], NOW);
    expect(shape).toBe("returning after 3 months quiet");
  });

  it("a short gap is a steady hum, not a comeback", () => {
    const shape = describeTimeShape([daysAgo(60), daysAgo(10), daysAgo(3)], NOW);
    expect(shape).toBe("held for 2 months; last fed 3 days ago");
    expect(
      describeTimeShape([daysAgo(30), daysAgo(15), daysAgo(1)], NOW),
      "singular units stay singular",
    ).toBe("held for 4 weeks; last fed 1 day ago");
  });

  it("a long-held pattern anchors in months and years", () => {
    const shape = describeTimeShape([daysAgo(500), daysAgo(400), daysAgo(30)], NOW);
    expect(shape).toBe("held for over a year; last fed 4 weeks ago");
  });
});

describe("diversifyRanked — no two voices on the board saying one thing", () => {
  /* orthogonal-ish toy vectors: A≈B (cos ~0.98), C far from both */
  const A = [1, 0.1, 0];
  const B = [1, 0.15, 0];
  const C = [0, 0, 1];
  const vectors = new Map<string, number[]>([
    ["a", A],
    ["b", B],
    ["c", C],
  ]);
  const ranked = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("holds a near-duplicate back so a distinct voice rises", () => {
    const out = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    expect(out.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("keeps the board shorter instead of refilling it with echoes", () => {
    const out = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    expect(out).toHaveLength(2);
    expect(out.slice(0, 2).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("a signal without an embedding is never held back", () => {
    const out = diversifyRanked(
      [{ id: "a" }, { id: "ghost" }, { id: "b" }],
      vectors,
      SELECTION_DIVERSITY_MAX_COSINE,
    );
    expect(out.map((s) => s.id)).toEqual(["a", "ghost"]);
  });

  it("is deterministic over identical input", () => {
    const once = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    const twice = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    expect(once).toEqual(twice);
  });
});


describe("assessShiftFloor — the board shifts at most once a day", () => {
  const NOW = new Date("2026-08-31T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

  it("the cold start is exempt: nothing to hold stable", () => {
    expect(assessShiftFloor(null, NOW)).toEqual({ held: false });
  });

  it("holds inside the floor, to the exact moment it opens", () => {
    const verdict = assessShiftFloor(hoursAgo(23.9), NOW);
    expect(verdict.held).toBe(true);
    if (verdict.held) {
      expect(verdict.heldUntil.getTime()).toBe(
        hoursAgo(23.9).getTime() + TOP_OF_MIND_MIN_SHIFT_HOURS * 60 * 60 * 1000,
      );
    }
  });

  it("passes once the floor has opened", () => {
    expect(assessShiftFloor(hoursAgo(24.1), NOW)).toEqual({ held: false });
    expect(assessShiftFloor(hoursAgo(24), NOW)).toEqual({ held: false });
  });
});
