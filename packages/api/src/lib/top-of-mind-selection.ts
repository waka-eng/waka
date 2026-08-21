/**
 * Layer 3, stage 1 — which signals the synthesis is allowed to see.
 *
 * Selection is deliberately deterministic and deliberately upstream of the
 * model: the same rows, the same clock and the same order produce the same
 * twelve signals every time, so when an artifact reads oddly the question
 * "what was it given?" has an answer that does not require replaying a
 * provider call. The ranking policy is a screenful of named weights rather
 * than inline numbers, because `docs/generation.md` publishes those numbers
 * and `generation-doc.test.ts` fails CI when the two disagree.
 *
 * The scope guard lives here and nowhere else in layer 3: every candidate is
 * filtered by `signals.profileId`, so the set handed to the provider — and
 * therefore the set `validateSynthesizedEntries` later checks citations
 * against — can only ever contain this profile's own patterns.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { feedback, inspirations, signalEvidence, signals } from "../db/index.js";
import type { getDb } from "./db.js";
import { computeSignalConfidence } from "./signal-derivation.js";

type WakaDb = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Selection tuning
//
// Named exports rather than inline numbers so Phase 5 can tune ranking in one
// diff, and so a reviewer can see the whole ranking policy in one screen.
// ---------------------------------------------------------------------------

/** How many signals the synthesis call is allowed to consider. */
export const TOP_OF_MIND_SIGNAL_LIMIT = 12;

/** Weights of the four ranking terms; they sum to 1. */
export const SELECTION_CONFIDENCE_WEIGHT = 0.45;
export const SELECTION_EVIDENCE_WEIGHT = 0.2;
export const SELECTION_RECENCY_WEIGHT = 0.2;
export const SELECTION_COMEBACK_WEIGHT = 0.15;

/**
 * Applied to a signal whose most recent verdict from its owner is "not_true".
 * A multiplier rather than an exclusion: the person may be wrong, the pattern
 * may return with new evidence, and a memory that silently drops whatever was
 * disputed is a memory that cannot be argued with. Disputed signals fight
 * uphill; they are not banished.
 */
export const SELECTION_DISPUTED_MULTIPLIER = 0.4;

/** Evidence count at which the support term saturates. */
export const SELECTION_EVIDENCE_SATURATION = 6;
/** Half-life of the recency term, in days. */
export const SELECTION_RECENCY_HALF_LIFE_DAYS = 30;

/**
 * A signal that went quiet and then came back is more interesting than one
 * that never stopped: the return is the person's own attention re-landing on
 * something, which is exactly what a top of mind is for. The bonus needs a
 * real gap before it, and the return itself has to be recent — a comeback
 * from four months ago is just history.
 */
export const COMEBACK_MIN_DORMANT_DAYS = 21;
export const COMEBACK_SATURATION_DAYS = 90;
export const COMEBACK_MAX_RETURN_AGE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// What selection hands on
// ---------------------------------------------------------------------------

export interface SelectedSignal {
  id: string;
  statement: string;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  score: number;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * The dormancy-comeback bonus, in 0..1, computed from one signal's evidence
 * timestamps: how long the gap before the newest piece of evidence was, and
 * whether that return is recent enough to still be a return.
 */
export function computeComebackBonus(evidenceAt: Date[], now: Date): number {
  if (evidenceAt.length < 2) return 0;

  const times = evidenceAt.map((date) => date.getTime()).sort((a, b) => a - b);
  const last = times[times.length - 1]!;
  const previous = times[times.length - 2]!;

  const returnAgeDays = (now.getTime() - last) / MS_PER_DAY;
  if (returnAgeDays > COMEBACK_MAX_RETURN_AGE_DAYS) return 0;

  const dormantDays = (last - previous) / MS_PER_DAY;
  if (dormantDays < COMEBACK_MIN_DORMANT_DAYS) return 0;

  const span = COMEBACK_SATURATION_DAYS - COMEBACK_MIN_DORMANT_DAYS;
  return Math.min(1, (dormantDays - COMEBACK_MIN_DORMANT_DAYS) / span);
}

/** 0..100. Deterministic: same rows, same clock, same order, every time. */
export function computeSelectionScore(input: {
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  comebackBonus: number;
  /** True when the owner's latest verdict on this signal is "not_true". */
  disputed?: boolean;
  now: Date;
}): number {
  const support = Math.min(1, input.evidenceCount / SELECTION_EVIDENCE_SATURATION);
  const quietDays = input.lastEvidenceAt
    ? Math.max(0, (input.now.getTime() - input.lastEvidenceAt.getTime()) / MS_PER_DAY)
    : Number.POSITIVE_INFINITY;
  const recency = Number.isFinite(quietDays)
    ? Math.pow(2, -quietDays / SELECTION_RECENCY_HALF_LIFE_DAYS)
    : 0;

  const score =
    SELECTION_CONFIDENCE_WEIGHT * input.confidence +
    SELECTION_EVIDENCE_WEIGHT * support * 100 +
    SELECTION_RECENCY_WEIGHT * recency * 100 +
    SELECTION_COMEBACK_WEIGHT * input.comebackBonus * 100;

  const damped = input.disputed ? score * SELECTION_DISPUTED_MULTIPLIER : score;

  return Math.max(0, Math.min(100, damped));
}

/**
 * Below this many active signals, the selection reaches into `emerging` ones
 * to reach a small artifact. It exists for the cold start: a signal needs
 * three pieces of evidence to become active, and a new profile rarely says
 * the same thing three ways in its first sitting, so an active-only selection
 * leaves it staring at nothing. A handful of forming patterns *is* what
 * currently matters to someone who just arrived — shown tentatively, and
 * superseded the moment real patterns cross the bar.
 *
 * The floor is also the ceiling on how far emerging reaches: once a profile
 * has this many active signals, emerging ones never appear, so an established
 * artifact is never diluted with single-observation noise.
 */
export const TOP_OF_MIND_MIN_SIGNALS = 3;

export interface SelectionOutcome {
  signals: SelectedSignal[];
  /** True when the selection leaned on emerging signals to fill the floor. */
  provisional: boolean;
}

export async function selectSignals(
  db: WakaDb,
  profileId: string,
  now: Date,
): Promise<SelectionOutcome> {
  const rows = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
      confidence: signals.confidence,
      lastEvidenceAt: signals.lastEvidenceAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, profileId),
        inArray(signals.status, ["active", "emerging"]),
        // A locked statement with no support left is still the owner's text,
        // but it is not evidence of anything current, and the artifact is a
        // claim about what is current.
        isNull(signals.unsupportedAt),
      ),
    )
    .orderBy(desc(signals.confidence), desc(signals.lastEvidenceAt));

  if (rows.length === 0) return { signals: [], provisional: false };

  const evidenceRows = await db
    .select({
      signalId: signalEvidence.signalId,
      createdAt: signalEvidence.createdAt,
      source: inspirations.source,
    })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(
      inArray(
        signalEvidence.signalId,
        rows.map((row) => row.id),
      ),
    );

  const evidenceBySignal = new Map<
    string,
    Array<{ createdAt: Date; source: "app" | "agent" }>
  >();
  for (const row of evidenceRows) {
    const bucket = evidenceBySignal.get(row.signalId);
    if (bucket) bucket.push(row);
    else evidenceBySignal.set(row.signalId, [row]);
  }

  // The latest verdict per signal decides `disputed` — newest first, first
  // write wins per target. A later "true" therefore lifts an older "not_true",
  // which is what changing one's mind should do.
  const verdictRows = await db
    .select({
      targetId: feedback.targetId,
      value: feedback.value,
    })
    .from(feedback)
    .where(
      and(
        eq(feedback.profileId, profileId),
        eq(feedback.targetType, "signal"),
        inArray(
          feedback.targetId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(desc(feedback.createdAt));

  const latestVerdict = new Map<string, string>();
  for (const row of verdictRows) {
    if (!latestVerdict.has(row.targetId)) latestVerdict.set(row.targetId, row.value);
  }

  const scored = rows
    .map((row) => {
      const evidence = evidenceBySignal.get(row.id) ?? [];
      const evidenceAt = evidence.map((item) => item.createdAt);
      // Live, not the stored snapshot: the snapshot was written the moment
      // evidence last landed — its decay term frozen at full — so ranking by
      // it would keep a signal that went quiet months ago scoring as if it
      // were still current. Time only passes for this signal if it passes
      // here, at read.
      const confidence = computeSignalConfidence(evidence, now);
      return {
        id: row.id,
        statement: row.statement,
        status: row.status,
        confidence,
        evidenceCount: evidenceAt.length,
        lastEvidenceAt: row.lastEvidenceAt,
        score: computeSelectionScore({
          confidence,
          evidenceCount: evidenceAt.length,
          lastEvidenceAt: row.lastEvidenceAt,
          comebackBonus: computeComebackBonus(evidenceAt, now),
          disputed: latestVerdict.get(row.id) === "not_true",
          now,
        }),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aRecency = a.lastEvidenceAt?.getTime() ?? 0;
      const bRecency = b.lastEvidenceAt?.getTime() ?? 0;
      if (bRecency !== aRecency) return bRecency - aRecency;
      // Ids as the last tiebreak so two identically-scored signals never
      // swap places between two runs over identical data.
      return a.id < b.id ? -1 : 1;
    });

  const strip = (s: (typeof scored)[number]): SelectedSignal => ({
    id: s.id,
    statement: s.statement,
    confidence: s.confidence,
    evidenceCount: s.evidenceCount,
    lastEvidenceAt: s.lastEvidenceAt,
    score: s.score,
  });

  const chosen = chooseSelection(
    scored.filter((s) => s.status === "active"),
    scored.filter((s) => s.status === "emerging"),
  );
  return { signals: chosen.signals.map(strip), provisional: chosen.provisional };
}

/**
 * The cold-start rule, isolated from the database so it can be reasoned about
 * directly. Both lists arrive already ranked, strongest first.
 *
 * With enough durable patterns, the artifact is those alone — identical to
 * the behaviour before the cold start existed, so an established profile is
 * never diluted with single-observation noise. Below the floor, the selection
 * borrows the strongest forming patterns, and only enough to reach the floor,
 * and reports itself provisional so the synthesis writes tentatively.
 */
export function chooseSelection<T>(
  active: T[],
  emerging: T[],
): { signals: T[]; provisional: boolean } {
  if (active.length >= TOP_OF_MIND_MIN_SIGNALS) {
    return { signals: active.slice(0, TOP_OF_MIND_SIGNAL_LIMIT), provisional: false };
  }
  const backfill = emerging.slice(0, Math.max(0, TOP_OF_MIND_MIN_SIGNALS - active.length));
  return { signals: [...active, ...backfill], provisional: backfill.length > 0 };
}
