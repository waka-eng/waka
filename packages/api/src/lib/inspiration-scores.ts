/**
 * Local inspiration score persistence.
 *
 * This helper intentionally uses only local, already-persisted signals. It does
 * not call embedding services, LLMs, clustering, user-action scoring, or any
 * WOW-moment generation path.
 */

import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";

import {
  attachments,
  inspirationEmbeddings,
  inspirationRevisitEvents,
  inspirations,
  reflections,
} from "../db/index.js";
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
  contextSignals?: {
    meaningfulLinkCount: number;
    nonLinkAttachmentCount: number;
    reflectionTextChars: number;
  };
  relationshipSignals?: {
    topSimilaritySignal: number;
    topSurpriseSimilaritySignal: number;
    timeDistanceSignal: number;
  };
  revisitSignals?: {
    uniqueRevisitDaysScore: number;
    totalRevisitCountScore: number;
    revisitedInLast7DaysScore: boolean | number;
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
const MAX_MEANINGFUL_LINKS = 3;
const MAX_CONTEXT_ATTACHMENTS = 3;
const MAX_REFLECTION_CONTEXT_CHARS = 1_000;
const MAX_CONTEXT_ROWS_PER_KIND = 20;
const MIN_MEANINGFUL_CONTEXT_CHARS = 8;
const MATURITY_SIGNAL_DAYS = 30;
const TIME_GAP_POTENTIAL_DAYS = 180;
const UNIQUE_REVISIT_DAYS_MAX = 7;
const TOTAL_REVISIT_COUNT_MAX = 20;
const RECENT_REVISIT_DAYS = 7;
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

export interface ContextScoreSignals {
  meaningfulLinkCount?: number;
  nonLinkAttachmentCount?: number;
  reflectionTextChars?: number;
}

function meaningfulNonUrlTextLength(value: string | null | undefined): number {
  if (!value) return 0;
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function hasMeaningfulNonUrlText(value: string | null | undefined): boolean {
  return meaningfulNonUrlTextLength(value) >= MIN_MEANINGFUL_CONTEXT_CHARS;
}

export function calculateContextScore(signals: ContextScoreSignals = {}) {
  // ContextScore rewards supporting context that helps a saved idea be useful
  // later, not raw URL spam. Bounded weights:
  //   40% meaningful link context/count (named links or links with surrounding text)
  //   30% non-link attachment count/presence (image/file rows)
  //   30% reflection question/answer text richness
  const linkScore = logNormalize(signals.meaningfulLinkCount ?? 0, {
    max: MAX_MEANINGFUL_LINKS,
  });
  const attachmentScore = logNormalize(signals.nonLinkAttachmentCount ?? 0, {
    max: MAX_CONTEXT_ATTACHMENTS,
  });
  const reflectionScore = logNormalize(signals.reflectionTextChars ?? 0, {
    max: MAX_REFLECTION_CONTEXT_CHARS,
  });

  return clamp01(0.4 * linkScore + 0.3 * attachmentScore + 0.3 * reflectionScore);
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
    contextScore: calculateContextScore(input.contextSignals),
  });

  const processing = calculateProcessingScore({
    hasReflection: input.hasReflection,
  });

  const revisitSignals = input.revisitSignals ?? {
    uniqueRevisitDaysScore: 0,
    totalRevisitCountScore: 0,
    revisitedInLast7DaysScore: false,
  };
  const revisit = calculateRevisitScore({
    uniqueRevisitDays: revisitSignals.uniqueRevisitDaysScore,
    totalRevisitCount: revisitSignals.totalRevisitCountScore,
    revisitedInLast7Days: revisitSignals.revisitedInLast7DaysScore,
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
  const reflectionRows = await db
    .select({
      id: reflections.id,
      question: reflections.question,
      answer: reflections.answer,
    })
    .from(reflections)
    .where(
      and(
        eq(reflections.inspirationId, row.id),
        eq(reflections.userId, row.userId),
      ),
    )
    .limit(MAX_CONTEXT_ROWS_PER_KIND);

  const attachmentRows = await db
    .select({
      type: attachments.type,
      name: attachments.name,
    })
    .from(attachments)
    .where(eq(attachments.inspirationId, row.id))
    .limit(MAX_CONTEXT_ROWS_PER_KIND);

  const textHasContextAroundUrl =
    /https?:\/\/\S+|www\.\S+/i.test(row.text) && hasMeaningfulNonUrlText(row.text);
  const meaningfulLinkCount = attachmentRows.filter(
    (attachment) =>
      attachment.type === "link" &&
      (hasMeaningfulNonUrlText(attachment.name) || textHasContextAroundUrl),
  ).length;
  const nonLinkAttachmentCount = attachmentRows.filter(
    (attachment) => attachment.type === "image" || attachment.type === "file",
  ).length;
  const reflectionTextChars = reflectionRows.reduce((total, reflection) => {
    return (
      total +
      meaningfulNonUrlTextLength(reflection.question) +
      meaningfulNonUrlTextLength(reflection.answer)
    );
  }, 0);

  return {
    hasReflection: reflectionRows.length > 0,
    contextSignals: {
      meaningfulLinkCount,
      nonLinkAttachmentCount,
      reflectionTextChars,
    },
  };
}

async function discoverRevisitSignals(db: Db, row: InspirationScoreRow) {
  const recentCutoff = new Date(
    Date.now() - RECENT_REVISIT_DAYS * 24 * 60 * 60 * 1000,
  );
  const recentCutoffIso = recentCutoff.toISOString();
  const [signals] = await db
    .select({
      uniqueRevisitDays: sql<number>`count(distinct date(${inspirationRevisitEvents.createdAt}))::int`,
      totalRevisitCount: sql<number>`count(*)::int`,
      recentRevisitCount: sql<number>`count(*) filter (where ${inspirationRevisitEvents.createdAt} >= ${recentCutoffIso}::timestamptz)::int`,
    })
    .from(inspirationRevisitEvents)
    .where(
      and(
        eq(inspirationRevisitEvents.userId, row.userId),
        eq(inspirationRevisitEvents.inspirationId, row.id),
      ),
    );

  const uniqueRevisitDays = Number(signals?.uniqueRevisitDays ?? 0);
  const totalRevisitCount = Number(signals?.totalRevisitCount ?? 0);
  const recentRevisitCount = Number(signals?.recentRevisitCount ?? 0);

  return {
    uniqueRevisitDaysScore: logNormalize(uniqueRevisitDays, {
      max: UNIQUE_REVISIT_DAYS_MAX,
    }),
    totalRevisitCountScore: logNormalize(totalRevisitCount, {
      max: TOTAL_REVISIT_COUNT_MAX,
    }),
    revisitedInLast7DaysScore: recentRevisitCount > 0,
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
  const revisitSignals = await discoverRevisitSignals(db, row);
  const relationship = await loadRelationshipCandidateRows(db, row, options);

  return calculateLocalInspirationScoreSnapshot({
    text: row.text,
    kind: row.kind,
    category: row.category,
    createdAt: row.createdAt,
    hasReflection: signals.hasReflection,
    contextSignals: signals.contextSignals,
    revisitSignals,
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

async function loadInspirationScoreRow(
  db: Db,
  params: { userId: string; inspirationId: string },
): Promise<InspirationScoreRow | null> {
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

  return row ?? null;
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

export async function persistSingleLocalInspirationScoreById(
  db: Db,
  params: { userId: string; inspirationId: string },
): Promise<PersistableInspirationScoreSnapshot | null> {
  const row = await loadInspirationScoreRow(db, params);
  if (!row) return null;

  const snapshot = await calculatePersistableSnapshot(db, row, { priorOnly: false });
  await updateInspirationScoreRow(db, row, snapshot);
  return snapshot;
}

export async function persistLocalInspirationScoresById(
  db: Db,
  params: { userId: string; inspirationId: string },
): Promise<PersistableInspirationScoreSnapshot | null> {
  const row = await loadInspirationScoreRow(db, params);
  if (!row) return null;

  return persistLocalInspirationScores(db, row);
}
