/**
 * The guarantees layer 3 makes in code rather than in a prompt.
 *
 * The live gate proves the artifact holds together over a real archive, but
 * it cannot prove the two things that matter most when the model misbehaves:
 * that a locked entry is reproduced from the stored row rather than from what
 * came back, and that a citation the profile does not hold never reaches the
 * database. Both are enforced here, so both are asserted here.
 */

import { describe, expect, it } from "vitest";

import {
  describeTimeShape,
  diversifyRanked,
  SELECTION_DIVERSITY_MAX_COSINE,
  applyGroupProposals,
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

describe("citations are checked against what the profile holds", () => {
  const owned = new Set(["signal-a", "signal-b"]);

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

  /** The whole point of the floor: an established profile is never diluted. */
  it("uses durable signals alone once there are enough of them", () => {
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
});

describe("applying accepted group proposals", () => {
  const NOW2 = new Date("2026-08-21T12:00:00.000Z");
  function groupEntry(id: string, overrides: Partial<CarriedEntry> = {}) {
    return { ...carried({ body: `Entry ${id}.`, ...overrides }), id };
  }

  /** An accepted edit is the members' own hand: it rewrites AND locks. */
  it("rewrites and locks the target of an accepted edit", () => {
    const { entries, applied } = applyGroupProposals(
      [groupEntry("e1"), groupEntry("e2", { sortOrder: 1 })],
      [{ kind: "edit_entry", entryId: "e1", body: "What the group decided it says." }],
      NOW2,
    );
    expect(applied).toBe(1);
    expect(entries[0]).toMatchObject({
      body: "What the group decided it says.",
      lockedAt: NOW2,
    });
    expect(entries[1]!.lockedAt).toBeNull();
  });

  it("dismisses the target of an accepted removal", () => {
    const { entries, applied } = applyGroupProposals(
      [groupEntry("e1")],
      [{ kind: "remove_entry", entryId: "e1", body: null }],
      NOW2,
    );
    expect(applied).toBe(1);
    expect(entries[0]!.dismissedAt).toBe(NOW2);
  });

  /** An accepted addition arrives locked, below everything standing. */
  it("appends an accepted addition as a locked entry at the bottom", () => {
    const { entries, applied } = applyGroupProposals(
      [groupEntry("e1", { sortOrder: 3 })],
      [{ kind: "add_entry", entryId: null, body: "A note the members wrote together." }],
      NOW2,
    );
    expect(applied).toBe(1);
    expect(entries[1]).toMatchObject({
      id: null,
      type: "pattern",
      body: "A note the members wrote together.",
      lockedAt: NOW2,
      sortOrder: 4,
      citedSignalIds: [],
    });
  });

  /** The target left before the decision landed: skip, and say so by count. */
  it("skips a proposal aimed at an entry that no longer exists", () => {
    const { entries, applied } = applyGroupProposals(
      [groupEntry("e1")],
      [{ kind: "edit_entry", entryId: "gone", body: "New words." }],
      NOW2,
    );
    expect(applied).toBe(0);
    expect(entries[0]!.body).toBe("Entry e1.");
  });

  it("applies nothing from an empty body and mutates no input", () => {
    const input = [groupEntry("e1")];
    const { applied } = applyGroupProposals(
      input,
      [
        { kind: "add_entry", entryId: null, body: "   " },
        { kind: "edit_entry", entryId: "e1", body: "" },
      ],
      NOW2,
    );
    expect(applied).toBe(0);
    expect(input[0]!.lockedAt).toBeNull();
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
    expect(out.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("the reserve returns whenever there is room — nothing is excluded outright", () => {
    const out = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    /* all three survive; only the ORDER moved, so a limit of three still
       seats everyone and only a limit of two feels the reorder */
    expect(out).toHaveLength(3);
    expect(out.slice(0, 2).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("a signal without an embedding is never held back", () => {
    const out = diversifyRanked(
      [{ id: "a" }, { id: "ghost" }, { id: "b" }],
      vectors,
      SELECTION_DIVERSITY_MAX_COSINE,
    );
    expect(out.map((s) => s.id)).toEqual(["a", "ghost", "b"]);
  });

  it("is deterministic over identical input", () => {
    const once = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    const twice = diversifyRanked(ranked, vectors, SELECTION_DIVERSITY_MAX_COSINE);
    expect(once).toEqual(twice);
  });
});
