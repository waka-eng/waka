/**
 * Local inspiration score persistence.
 *
 * This helper intentionally uses only local, already-persisted signals. It does
 * not call embedding services, LLMs, clustering, user-action scoring, or any
 * WOW-moment generation path.
 */

import { and, eq } from "drizzle-orm";

import { inspirations, reflections } from "../db/index.js";
import type { getDb } from "./db.js";
import {
  calculateContentDepthScore,
  calculateDisplayedScore,
  calculateFreshnessDecayScore,
  calculateImportanceScore,
  calculateProcessingScore,
  calculateRevisitScore,
  calculateWowScore,
  clamp01,
  logNormalize,
  toPersistedScore,
} from "../scoring/wow-score.js";

type Db = ReturnType<typeof getDb>;

export interface LocalInspirationScoreInput {
  text: string;
  kind: string | null;
  category: number | null;
  createdAt: Date;
  hasReflection: boolean;
  now?: Date;
}

export interface PersistableInspirationScoreSnapshot {
  importanceScore: number;
  /** Persisted core WOW score (0..100), excluding freshness display boost. */
  wowScore: number;
}

export interface InspirationScoreRow {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  category: number | null;
  createdAt: Date;
}

const MAX_TEXT_DEPTH_CHARS = 8192;
const MATURITY_SIGNAL_DAYS = 30;
const TIME_GAP_POTENTIAL_DAYS = 180;

export function calculateAgeDays(createdAt: Date, now = new Date()): number {
  const createdMs = createdAt.getTime();
  const nowMs = now.getTime();

  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) {
    return 0;
  }

  return Math.max(0, (nowMs - createdMs) / (24 * 60 * 60 * 1000));
}

function calculateContextScore() {
  // Current persisted inspiration rows only expose coarse kind/category and
  // attachment presence. Those are not meaningful rich context/caption/link
  // signals, so keep ContextScore conservative until such fields exist.
  return 0;
}

function calculateCreatedAtTimeSignal(createdAt: Date, now = new Date()) {
  const ageDays = calculateAgeDays(createdAt, now);
  const maturityScore = clamp01(ageDays / MATURITY_SIGNAL_DAYS);
  const timeGapPotentialScore = clamp01(ageDays / TIME_GAP_POTENTIAL_DAYS);

  return clamp01(0.5 * maturityScore + 0.5 * timeGapPotentialScore);
}

export function calculateDisplayedInspirationScore(input: {
  coreWowScore: number;
  createdAt: Date;
  now?: Date;
}): number {
  const freshnessDecay = calculateFreshnessDecayScore({
    ageDays: calculateAgeDays(input.createdAt, input.now),
  });
  const displayedScore = calculateDisplayedScore({
    coreWowScore: clamp01(input.coreWowScore / 100),
    freshnessDecay,
  });

  return toPersistedScore(displayedScore);
}

export function calculateLocalInspirationScoreSnapshot(
  input: LocalInspirationScoreInput,
): PersistableInspirationScoreSnapshot {
  const contentDepth = calculateContentDepthScore({
    textDepth: logNormalize(input.text.length, { max: MAX_TEXT_DEPTH_CHARS }),
    contextScore: calculateContextScore(),
  });

  const processing = calculateProcessingScore({
    hasReflection: input.hasReflection,
  });

  // There is no revisit table/signal in the current schema. Keep the score at
  // zero until concrete revisit data exists rather than inferring it from list
  // reads or other user actions.
  const revisit = calculateRevisitScore({
    uniqueRevisitDays: 0,
    totalRevisitCount: 0,
    revisitedInLast7Days: false,
  });

  const timeSignal = calculateCreatedAtTimeSignal(input.createdAt, input.now);

  const importance = calculateImportanceScore({
    contentDepth,
    processing,
    revisit,
    timeSignal,
  });

  // Relationship signals are deliberately zero until embeddings/surprise
  // similarity are wired. This keeps persisted WOW scores conservative and
  // prevents list reads from synthesising relationship-derived signal.
  const wow = calculateWowScore({
    importance,
    topSimilaritySignal: 0,
    topSurpriseSimilaritySignal: 0,
    timeDistanceSignal: 0,
  });

  return {
    importanceScore: toPersistedScore(importance),
    wowScore: toPersistedScore(wow),
  };
}

async function discoverLocalScoreSignals(db: Db, row: InspirationScoreRow) {
  const [reflection] = await db
    .select({ id: reflections.id })
    .from(reflections)
    .where(
      and(
        eq(reflections.inspirationId, row.id),
        eq(reflections.userId, row.userId),
      ),
    )
    .limit(1);

  return {
    hasReflection: Boolean(reflection),
  };
}

export async function persistLocalInspirationScores(
  db: Db,
  row: InspirationScoreRow,
): Promise<PersistableInspirationScoreSnapshot> {
  const signals = await discoverLocalScoreSignals(db, row);
  const snapshot = calculateLocalInspirationScoreSnapshot({
    text: row.text,
    kind: row.kind,
    category: row.category,
    createdAt: row.createdAt,
    hasReflection: signals.hasReflection,
  });

  await db
    .update(inspirations)
    .set({
      importanceScore: snapshot.importanceScore,
      wowScore: snapshot.wowScore,
    } as Partial<typeof inspirations.$inferInsert>)
    .where(and(eq(inspirations.id, row.id), eq(inspirations.userId, row.userId)));

  return snapshot;
}
