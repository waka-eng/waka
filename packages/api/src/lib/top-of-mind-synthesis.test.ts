/**
 * The guarantees layer 3 makes in code rather than in a prompt.
 *
 * The live gate proves the artifact holds together over a real archive, but
 * it cannot prove the two things that matter most when the model misbehaves:
 * that a locked entry is reproduced from the stored row rather than from what
 * came back, and that a citation the profile does not hold never reaches the
 * database. Both are enforced in code, so both are asserted here.
 *
 * The subjects live in the stage modules the pass runs in order —
 * `top-of-mind-selection.ts`, `-artifact.ts`, `-validation.ts`,
 * `-versioning.ts` — and every one of them is a pure function or a snapshot
 * type, which is why this suite needs neither a database nor a provider.
 */

import { describe, expect, it } from "vitest";

import { type CarriedEntry } from "./top-of-mind-artifact.js";
import {
  chooseSelection,
  computeComebackBonus,
  computeSelectionScore,
  SELECTION_DISPUTED_MULTIPLIER,
  TOP_OF_MIND_MIN_SIGNALS,
  TOP_OF_MIND_SIGNAL_LIMIT,
} from "./top-of-mind-selection.js";
import {
  countLockViolations,
  validateSynthesizedEntries,
} from "./top-of-mind-validation.js";
import { assembleEntries, isUnchanged } from "./top-of-mind-versioning.js";

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
