/**
 * Candidate retrieval for future WOW moment generation.
 *
 * This slice is intentionally retrieval/scoring only: it does not call an LLM,
 * does not create wow_moments rows, and does not persist request-time runtime
 * candidate scores. Persisted relationship signal updates are deferred until a
 * later bounded worker can update `wow_score` from durable top-k aggregates with
 * clear backfill/recompute semantics.
 */

import { and, desc, eq, ne } from "drizzle-orm";

import { inspirationEmbeddings, inspirations, type Inspiration } from "../db/index.js";
import {
  calculateRuntimeCandidateScore,
  calculateSimilarityScore,
  calculateSurpriseSimilarityScore,
  clamp01,
  cosineSimilarity,
  fromPersistedScore,
  logNormalize,
  type RuntimeCandidateScore,
  type SimilarityScore,
  type SurpriseSimilarityScore,
  type TimeSignalScore,
  type WowScore,
} from "../scoring/wow-score.js";
import { getDb } from "./db.js";
import type { WakaDb } from "./inspiration-embeddings.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
export const MAX_DB_CANDIDATE_POOL = 200;
const SURPRISE_SIMILARITY_PEAK = 0.55;
const TIME_DISTANCE_MAX_DAYS = 365;

export interface FindWowMomentCandidatesParams {
  userId: string;
  triggerInspirationId: string;
  limit?: number;
  db?: WakaDb;
}

export interface WowMomentCandidateScoreBreakdown {
  /** Direct cosine similarity to the trigger embedding, normalized to 0..1. */
  similarityScoreToTrigger: SimilarityScore;
  /** Medium-similarity bridge signal: peaks around a non-obvious relatedness band. */
  surpriseSimilarityScoreToTrigger: SurpriseSimilarityScore;
  /** Time gap signal between trigger and candidate, normalized to 0..1. */
  timeDistanceScoreToTrigger: TimeSignalScore;
  /** Candidate's persisted wow_score snapshot, converted from 0..100 to 0..1. */
  persistedWowScore: WowScore;
  /** Request-time ranking score only; never persisted by this helper. */
  runtimeCandidateScore: RuntimeCandidateScore;
}

export interface WowMomentCandidate {
  inspiration: Pick<
    Inspiration,
    | "id"
    | "userId"
    | "text"
    | "kind"
    | "category"
    | "cluster"
    | "importanceScore"
    | "wowScore"
    | "createdAt"
    | "updatedAt"
  >;
  embedding: {
    model: string;
    dimensions: number;
    inputHash: string;
    updatedAt: Date;
  };
  scores: WowMomentCandidateScoreBreakdown;
}

export interface FindWowMomentCandidatesResult {
  trigger: Pick<
    Inspiration,
    | "id"
    | "userId"
    | "text"
    | "kind"
    | "category"
    | "cluster"
    | "importanceScore"
    | "wowScore"
    | "createdAt"
    | "updatedAt"
  > | null;
  candidates: WowMomentCandidate[];
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_LIMIT)) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
}

function dbCandidatePoolLimit(limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(MAX_DB_CANDIDATE_POOL, Math.max(limit * 5, limit + 20));
}

function calculateSurpriseSimilarityFromDirectSimilarity(
  similarity: SimilarityScore,
): SurpriseSimilarityScore {
  const normalizedSimilarity = clamp01(similarity);
  const distanceFromPeak = Math.abs(normalizedSimilarity - SURPRISE_SIMILARITY_PEAK);
  const maxDistance = Math.max(SURPRISE_SIMILARITY_PEAK, 1 - SURPRISE_SIMILARITY_PEAK);

  return calculateSurpriseSimilarityScore(1 - distanceFromPeak / maxDistance);
}

function calculateTimeDistanceScore(a: Date, b: Date): TimeSignalScore {
  const milliseconds = Math.abs(a.getTime() - b.getTime());
  const days = milliseconds / (1000 * 60 * 60 * 24);

  return logNormalize(days, { max: TIME_DISTANCE_MAX_DAYS });
}

async function loadTriggerWithEmbedding(
  db: WakaDb,
  userId: string,
  inspirationId: string,
) {
  const rows = await db
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
        eq(inspirationEmbeddings.userId, userId),
        eq(inspirationEmbeddings.inspirationId, inspirationId),
        eq(inspirations.userId, userId),
        eq(inspirations.id, inspirationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function loadTenantCandidatePool(
  db: WakaDb,
  userId: string,
  triggerInspirationId: string,
  triggerEmbedding: { model: string; dimensions: number; embedding: number[] },
  poolLimit: number,
) {
  // TODO(pgvector): once the extension is available in local + production DBs,
  // replace this explainable bounded preselection with an ANN cosine query.
  // For now, keep embedding as jsonb number[] and use the indexed tenant/model/
  // dimensions predicate plus durable inspiration signals to cap DB rows before
  // app-side cosine ranking.
  return db
    .select({
      inspiration: inspirations,
      embedding: inspirationEmbeddings,
    })
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
        eq(inspirationEmbeddings.userId, userId),
        eq(inspirations.userId, userId),
        ne(inspirationEmbeddings.inspirationId, triggerInspirationId),
        eq(inspirationEmbeddings.model, triggerEmbedding.model),
        eq(inspirationEmbeddings.dimensions, triggerEmbedding.dimensions),
      ),
    )
    .orderBy(desc(inspirations.wowScore), desc(inspirations.createdAt))
    .limit(Math.min(poolLimit, MAX_DB_CANDIDATE_POOL));
}

/**
 * Find tenant-scoped, already-embedded inspirations that can participate in a
 * future WOW moment alongside `triggerInspirationId`.
 */
export async function findWowMomentCandidates(
  params: FindWowMomentCandidatesParams,
): Promise<FindWowMomentCandidatesResult> {
  const db = params.db ?? getDb();
  const limit = normalizeLimit(params.limit);

  const trigger = await loadTriggerWithEmbedding(
    db,
    params.userId,
    params.triggerInspirationId,
  );
  if (!trigger || limit === 0) {
    return { trigger: trigger?.inspiration ?? null, candidates: [] };
  }

  const candidatePool = await loadTenantCandidatePool(
    db,
    params.userId,
    params.triggerInspirationId,
    trigger.embedding,
    dbCandidatePoolLimit(limit),
  );

  const candidates = candidatePool
    .filter(({ embedding }) => embedding.embedding.length === trigger.embedding.embedding.length)
    .map(({ inspiration, embedding }) => {
      const similarityScoreToTrigger = calculateSimilarityScore(
        cosineSimilarity(trigger.embedding.embedding, embedding.embedding),
      );
      const surpriseSimilarityScoreToTrigger = calculateSurpriseSimilarityFromDirectSimilarity(
        similarityScoreToTrigger,
      );
      const timeDistanceScoreToTrigger = calculateTimeDistanceScore(
        trigger.inspiration.createdAt,
        inspiration.createdAt,
      );
      const persistedWowScore = fromPersistedScore(inspiration.wowScore);
      const runtimeCandidateScore = calculateRuntimeCandidateScore({
        wowScore: persistedWowScore,
        similarityToTrigger: similarityScoreToTrigger,
        surpriseSimilarityToTrigger: surpriseSimilarityScoreToTrigger,
        timeDistanceToTrigger: timeDistanceScoreToTrigger,
      });

      return {
        inspiration: {
          id: inspiration.id,
          userId: inspiration.userId,
          text: inspiration.text,
          kind: inspiration.kind,
          category: inspiration.category,
          cluster: inspiration.cluster,
          importanceScore: inspiration.importanceScore,
          wowScore: inspiration.wowScore,
          createdAt: inspiration.createdAt,
          updatedAt: inspiration.updatedAt,
        },
        embedding: {
          model: embedding.model,
          dimensions: embedding.dimensions,
          inputHash: embedding.inputHash,
          updatedAt: embedding.updatedAt,
        },
        scores: {
          similarityScoreToTrigger,
          surpriseSimilarityScoreToTrigger,
          timeDistanceScoreToTrigger,
          persistedWowScore,
          runtimeCandidateScore,
        },
      } satisfies WowMomentCandidate;
    })
    .sort((a, b) => {
      const scoreDelta =
        b.scores.runtimeCandidateScore - a.scores.runtimeCandidateScore;
      if (scoreDelta !== 0) return scoreDelta;

      return b.inspiration.createdAt.getTime() - a.inspiration.createdAt.getTime();
    })
    .slice(0, limit);

  return { trigger: trigger.inspiration, candidates };
}
