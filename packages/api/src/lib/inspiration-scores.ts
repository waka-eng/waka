/**
 * Local inspiration score persistence.
 *
 * This helper intentionally uses only local, already-persisted signals. It does
 * not call embedding services, LLMs, clustering, user-action scoring, or any
 * WOW-moment generation path.
 */

import { and, desc, eq, lt, ne } from "drizzle-orm";

import { inspirationEmbeddings, inspirations, reflections } from "../db/index.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import {
  calculateContentDepthScore,
  calculateDisplayedScore,
  calculateFreshnessDecayScore,
  calculateImportanceScore,
  calculateProcessingScore,
  calculateRevisitScore,
  calculateWowScore,
  aggregateRelationshipSignals,
  clamp01,
  cosineSimilarity,
  logNormalize,
  toPersistedScore,
} from "../scoring/wow-score.js";

type Db = WakaDb;

export interface LocalInspirationScoreInput {
  text: string;
  kind: string | null;
  category: number | null;
  createdAt: Date;
  hasReflection: boolean;
  relationshipSignals?: {
    topSimilaritySignal: number;
    topSurpriseSimilaritySignal: number;
    timeDistanceSignal: number;
  };
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
export const CANDIDATE_RETRIEVAL_LIMIT = 50;
export const SCORE_UPDATE_LIMIT = 20;

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

  const relationshipSignals = input.relationshipSignals ?? {
    topSimilaritySignal: 0,
    topSurpriseSimilaritySignal: 0,
    timeDistanceSignal: 0,
  };
  const wow = calculateWowScore({
    importance,
    topSimilaritySignal: relationshipSignals.topSimilaritySignal,
    topSurpriseSimilaritySignal: relationshipSignals.topSurpriseSimilaritySignal,
    timeDistanceSignal: relationshipSignals.timeDistanceSignal,
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

async function loadStoredEmbedding(db: Db, row: InspirationScoreRow) {
  const [embedding] = await db
    .select()
    .from(inspirationEmbeddings)
    .where(
      and(
        eq(inspirationEmbeddings.userId, row.userId),
        eq(inspirationEmbeddings.inspirationId, row.id),
      ),
    )
    .limit(1);

  return embedding ?? null;
}

async function loadRelationshipCandidateRows(
  db: Db,
  row: InspirationScoreRow,
  options: { priorOnly: boolean },
) {
  const currentEmbedding = await loadStoredEmbedding(db, row);
  if (!currentEmbedding) {
    return {
      currentEmbedding: null,
      relationshipSignals: {
        topSimilaritySignal: 0,
        topSurpriseSimilaritySignal: 0,
        timeDistanceSignal: 0,
      },
      relatedRows: [] as InspirationScoreRow[],
    };
  }

  const candidateRows = await db
    .select({ inspiration: inspirations, embedding: inspirationEmbeddings })
    .from(inspirationEmbeddings)
    .innerJoin(
      inspirations,
      and(
        eq(inspirations.id, inspirationEmbeddings.inspirationId),
        eq(inspirations.userId, inspirationEmbeddings.userId),
      ),
    )
    .where(
      and(
        eq(inspirationEmbeddings.userId, row.userId),
        ne(inspirationEmbeddings.inspirationId, row.id),
        eq(inspirationEmbeddings.model, currentEmbedding.model),
        eq(inspirationEmbeddings.dimensions, currentEmbedding.dimensions),
        options.priorOnly ? lt(inspirations.createdAt, row.createdAt) : undefined,
      ),
    )
    .orderBy(desc(inspirations.wowScore), desc(inspirations.createdAt))
    .limit(CANDIDATE_RETRIEVAL_LIMIT);

  const scored = candidateRows
    .filter(({ embedding }) => embedding.embedding.length === currentEmbedding.embedding.length)
    .map(({ inspiration, embedding }) => ({
      row: {
        id: inspiration.id,
        userId: inspiration.userId,
        text: inspiration.text,
        kind: inspiration.kind,
        category: inspiration.category,
        createdAt: inspiration.createdAt,
      },
      similarity: cosineSimilarity(currentEmbedding.embedding, embedding.embedding),
      daysApart: Math.abs(
        (row.createdAt.getTime() - inspiration.createdAt.getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SCORE_UPDATE_LIMIT);

  return {
    currentEmbedding,
    relationshipSignals: aggregateRelationshipSignals({
      candidates: scored.map((candidate) => ({
        similarity: candidate.similarity,
        daysApart: candidate.daysApart,
      })),
      limit: SCORE_UPDATE_LIMIT,
    }),
    relatedRows: scored.map((candidate) => candidate.row),
  };
}

async function calculatePersistableSnapshot(
  db: Db,
  row: InspirationScoreRow,
  options: { priorOnly: boolean },
): Promise<PersistableInspirationScoreSnapshot> {
  const signals = await discoverLocalScoreSignals(db, row);
  const relationship = await loadRelationshipCandidateRows(db, row, options);

  return calculateLocalInspirationScoreSnapshot({
    text: row.text,
    kind: row.kind,
    category: row.category,
    createdAt: row.createdAt,
    hasReflection: signals.hasReflection,
    relationshipSignals: relationship.relationshipSignals,
  });
}

async function updateInspirationScoreRow(
  db: Db,
  row: InspirationScoreRow,
  snapshot: PersistableInspirationScoreSnapshot,
) {
  await db
    .update(inspirations)
    .set({
      importanceScore: snapshot.importanceScore,
      wowScore: snapshot.wowScore,
    } as Partial<typeof inspirations.$inferInsert>)
    .where(and(eq(inspirations.id, row.id), eq(inspirations.userId, row.userId)));
}

export async function persistLocalInspirationScores(
  db: Db,
  row: InspirationScoreRow,
): Promise<PersistableInspirationScoreSnapshot> {
  const relationship = await loadRelationshipCandidateRows(db, row, { priorOnly: true });
  const snapshot = await calculatePersistableSnapshot(db, row, { priorOnly: true });

  await updateInspirationScoreRow(db, row, snapshot);

  for (const relatedRow of relationship.relatedRows) {
    const relatedSnapshot = await calculatePersistableSnapshot(db, relatedRow, {
      priorOnly: false,
    });
    await updateInspirationScoreRow(db, relatedRow, relatedSnapshot);
  }

  return snapshot;
}

export async function persistLocalInspirationScoresById(
  db: Db,
  params: { userId: string; inspirationId: string },
): Promise<PersistableInspirationScoreSnapshot | null> {
  const [row] = await db
    .select({
      id: inspirations.id,
      userId: inspirations.userId,
      text: inspirations.text,
      kind: inspirations.kind,
      category: inspirations.category,
      createdAt: inspirations.createdAt,
    })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, params.inspirationId),
        eq(inspirations.userId, params.userId),
      ),
    )
    .limit(1);

  if (!row) return null;

  return persistLocalInspirationScores(db, row);
}
