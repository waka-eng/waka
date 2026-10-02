/**
 * What evidence does to a signal: confidence, promotion, and what is left of
 * a signal when its evidence goes away.
 *
 * Nothing here calls a model or an embedding service. That is the whole reason
 * this stage is its own file: in a derivation pass the model only *proposes*
 * statements (`signal-derivation.ts`) and cosine distance decides which of
 * them are the same pattern (`signal-match-or-mint.ts`) — everything about a
 * signal's standing is arithmetic over rows already written. A number an owner
 * is shown must be one we can re-derive for them on demand, which is why
 * `computeSignalConfidence` takes an evidence set and a clock and nothing else.
 *
 * `refreshSignalLifecycle` is exported for one caller, match-or-mint, which
 * runs it for each signal it touched inside the same transaction. It is not
 * part of the module's public story; it crosses the file boundary because the
 * stage boundary is between "decide identity" and "recompute standing", and
 * that call is where the first hands over to the second.
 */

import { and, desc, eq } from "drizzle-orm";

import {
  feedback,
  inspirations,
  signalEvidence,
  signals,
  type SignalStatus,
} from "../db/index.js";
import { getDb } from "./db.js";
import { feedbackWordingCurrent } from './feedback-revisions.js';
import {
  CONFIDENCE_AFFIRMED_BONUS,
  CONFIDENCE_RECENCY_HALF_LIFE_DAYS,
  CONFIDENCE_RECENCY_WEIGHT,
  CONFIDENCE_SATURATION_EVIDENCE,
  CONFIDENCE_SATURATION_SPREAD_DAYS,
  CONFIDENCE_SOURCE_DIVERSITY_BONUS,
  CONFIDENCE_SPREAD_WEIGHT,
  CONFIDENCE_SUPPORT_WEIGHT,
  SIGNAL_PROMOTION_MIN_EVIDENCE,
} from "./signal-derivation-thresholds.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ConfidenceEvidence {
  createdAt: Date;
  source: "app" | "agent";
}

/**
 * Confidence from the rows alone: how much evidence there is, how far it
 * spreads in time, how recently it last arrived, whether more than one kind
 * of capturer supplied it — and whether the owner has said "yes, this is
 * me" (their latest standing verdict, an arithmetic fact off the feedback
 * rows). No model input — a number the owner can be told the derivation of.
 */
export function computeSignalConfidence(
  evidence: ConfidenceEvidence[],
  now: Date,
  opts: { affirmed?: boolean } = {},
): number {
  if (evidence.length === 0) return 0;

  const evidenceAt = evidence.map((row) => row.createdAt);
  const distinctSources = new Set(evidence.map((row) => row.source)).size;
  const times = evidenceAt.map((date) => date.getTime()).sort((a, b) => a - b);
  const first = times[0]!;
  const last = times[times.length - 1]!;

  const support = Math.min(1, times.length / CONFIDENCE_SATURATION_EVIDENCE);
  const spreadDays = (last - first) / MS_PER_DAY;
  const spread = Math.min(1, spreadDays / CONFIDENCE_SATURATION_SPREAD_DAYS);
  const quietDays = Math.max(0, (now.getTime() - last) / MS_PER_DAY);
  const recency = Math.pow(2, -quietDays / CONFIDENCE_RECENCY_HALF_LIFE_DAYS);

  const score =
    CONFIDENCE_SUPPORT_WEIGHT * support +
    CONFIDENCE_SPREAD_WEIGHT * spread +
    CONFIDENCE_RECENCY_WEIGHT * recency +
    (distinctSources > 1 ? CONFIDENCE_SOURCE_DIVERSITY_BONUS : 0) +
    (opts.affirmed ? CONFIDENCE_AFFIRMED_BONUS : 0);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Recompute everything derived from evidence: confidence, the denormalized
 * recency, promotion, and whether a locked signal is supported again.
 * Returns true when this pass promoted the signal to `active`.
 */
export async function refreshSignalLifecycle(
  tx: WakaTx,
  signalId: string,
  now: Date,
): Promise<boolean> {
  const [current] = await tx
    .select()
    .from(signals)
    .where(eq(signals.id, signalId))
    .limit(1);
  if (!current) return false;

  /*
    EVIDENCE IS DATED BY THE CAPTURE THAT WITNESSES IT — `inspirations
    .createdAt`, never the evidence row's own timestamp. The row's createdAt
    is merely when the LINK was noticed, and the two diverge exactly when it
    matters: a capture from months ago cited retroactively (a related capture
    named at a later derivation) would otherwise register as fresh evidence
    today — inflating the recency term and collapsing the spread term in the
    same stroke. Confidence claims to measure the pattern's life in the
    person's history; the capture date is when that life happened. Selection,
    the principle span bar, and the read routes all follow this same rule.
  */
  const evidenceRows = await tx
    .select({ createdAt: inspirations.createdAt, source: inspirations.source })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(eq(signalEvidence.signalId, signalId));

  /* the latest standing verdict, latest-wins — the same read selection
     makes, kept in this transaction so the snapshot and the live number
     agree about what the owner has said */
  const [verdictRow] = await tx
    .select({ value: feedback.value })
    .from(feedback)
    .where(
      and(
        eq(feedback.profileId, current.profileId),
        eq(feedback.targetType, "signal"),
        feedbackWordingCurrent(),
        eq(feedback.targetId, signalId),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(1);

  const evidenceAt = evidenceRows.map((row) => row.createdAt);
  const confidence = computeSignalConfidence(evidenceRows, now, {
    affirmed: verdictRow?.value === "true",
  });
  const lastEvidenceAt = evidenceAt.reduce<Date | null>(
    (latest, date) => (latest === null || date > latest ? date : latest),
    null,
  );

  const recovered = current.status === "retired" && current.supportRetiredAt !== null &&
    current.dismissedAt === null && evidenceAt.length > 0;
  const promote =
    (current.status === "emerging" || recovered) && evidenceAt.length >= SIGNAL_PROMOTION_MIN_EVIDENCE;
  const status: SignalStatus = promote ? "active" : recovered ? "emerging" : current.status;

  await tx
    .update(signals)
    .set({
      status,
      confidence,
      lastEvidenceAt,
      // Support returned. A locked signal keeps its text either way; what
      // changes is that readers stop being told it stands on nothing.
      unsupportedAt: evidenceAt.length > 0 ? null : current.unsupportedAt,
      supportRetiredAt: recovered ? null : current.supportRetiredAt,
      updatedAt: now,
    })
    .where(eq(signals.id, signalId));

  return promote;
}

/**
 * Settle signals whose citations have just been deleted.
 *
 * Evidence rows vanish by foreign-key cascade when an inspiration is deleted,
 * which leaves a signal standing on nothing while still claiming to be
 * active. Deletion is the one path where support disappears without any
 * derivation pass running, so the reconciliation has to be driven from the
 * delete itself.
 *
 * What happens to a stranded signal depends on whose words it is. A generated
 * statement is retired: nothing supports it and nobody chose it. A locked one
 * is the owner's own sentence, so it stays and is marked unsupported instead —
 * deleting a person's writing because its footnotes went would be WAKA
 * editing them.
 *
 * Callers pass the signal ids collected *before* the delete, since afterwards
 * there is nothing left to join through.
 */
export async function reconcileSignalsAfterEvidenceLoss(
  db: WakaDb | WakaTx,
  input: { profileId: string; signalIds: string[] },
): Promise<{ retired: string[]; unsupported: string[] }> {
  const retired: string[] = [];
  const unsupported: string[] = [];
  if (input.signalIds.length === 0) return { retired, unsupported };

  const now = new Date();

  for (const signalId of input.signalIds) {
    const [signal] = await db
      .select({
        id: signals.id,
        status: signals.status,
        lockedAt: signals.lockedAt,
      })
      .from(signals)
      .where(and(eq(signals.id, signalId), eq(signals.profileId, input.profileId)))
      .limit(1);
    if (!signal || signal.status === "retired") continue;

    const remaining = await db
      .select({ createdAt: inspirations.createdAt, source: inspirations.source })
      .from(signalEvidence)
      .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
      .where(eq(signalEvidence.signalId, signalId));

    if (remaining.length > 0) {
      // Still supported, just by less. Confidence and recency move with it.
      const evidenceAt = remaining.map((row) => row.createdAt);
      await db
        .update(signals)
        .set({
          confidence: computeSignalConfidence(remaining, now),
          lastEvidenceAt: evidenceAt.reduce<Date | null>(
            (latest, date) => (latest === null || date > latest ? date : latest),
            null,
          ),
          unsupportedAt: null,
          updatedAt: now,
        })
        .where(eq(signals.id, signalId));
      continue;
    }

    if (signal.lockedAt) {
      await db
        .update(signals)
        .set({ unsupportedAt: now, supportRetiredAt: null, confidence: 0, lastEvidenceAt: null, updatedAt: now })
        .where(eq(signals.id, signalId));
      unsupported.push(signalId);
    } else {
      // Retirement already says everything: `unsupported_at` is reserved for
      // the locked survivor, where "your words stand, nothing supports them"
      // is a distinct fact a reader needs. Setting it here too would make an
      // ordinary retired row read as that special case.
      await db
        .update(signals)
        .set({
          status: "retired",
          supportRetiredAt: now,
          confidence: 0,
          lastEvidenceAt: null,
          unsupportedAt: null,
          updatedAt: now,
        })
        .where(eq(signals.id, signalId));
      retired.push(signalId);
    }
  }

  return { retired, unsupported };
}
