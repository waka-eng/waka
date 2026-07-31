/**
 * Candidate retrieval for future WOW moment generation.
 *
 * This slice is intentionally retrieval/scoring only: it does not call an LLM,
 * does not create wow_moments rows, and does not persist request-time runtime
 * candidate scores. Persisted relationship signal updates are deferred until a
 * later bounded worker can update `wow_score` from durable top-k aggregates with
 * clear backfill/recompute semantics.
 */

import { and, desc, eq, inArray, ne } from "drizzle-orm";

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
import { isNearDuplicateTopOfMindText } from "./top-of-mind-dedupe.js";

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

export function scoreCandidateSurprise(similarity: SimilarityScore): SurpriseSimilarityScore {
  return calculateSurpriseSimilarityFromDirectSimilarity(similarity);
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

export function diversifyWowMomentCandidates(
  rankedCandidates: WowMomentCandidate[],
  limit: number,
): WowMomentCandidate[] {
  if (limit <= 0) return [];
  const selected: WowMomentCandidate[] = [];
  const deferred: WowMomentCandidate[] = [];

  for (const candidate of rankedCandidates) {
    const isNearDuplicate = selected.some((existing) =>
      isNearDuplicateTopOfMindText(existing.inspiration.text, candidate.inspiration.text),
    );
    if (!isNearDuplicate) {
      selected.push(candidate);
    } else {
      deferred.push(candidate);
    }
    if (selected.length >= limit) break;
  }

  if (selected.length < Math.min(limit, rankedCandidates.length)) {
    selected.push(...deferred.slice(0, limit - selected.length));
  }

  return selected.slice(0, limit);
}

type TriggerWithEmbedding = NonNullable<
  Awaited<ReturnType<typeof loadTriggerWithEmbedding>>
>;
type CandidatePoolRow = Awaited<ReturnType<typeof loadTenantCandidatePool>>[number];

/** Score every candidate against the trigger, strongest first (no diversify). */
function scoreCandidates(
  trigger: TriggerWithEmbedding,
  candidatePool: CandidatePoolRow[],
): WowMomentCandidate[] {
  return candidatePool
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
    });
}

/**
 * Score and text-diversify a candidate pool against a trigger. Used by the
 * single-user retrieval path.
 */
function rankAndDiversifyCandidates(
  trigger: TriggerWithEmbedding,
  candidatePool: CandidatePoolRow[],
  limit: number,
): WowMomentCandidate[] {
  return diversifyWowMomentCandidates(scoreCandidates(trigger, candidatePool), limit);
}

/**
 * Group candidate selection: keep the highest-similarity candidates (so the set
 * stays semantically COHERENT enough for the judge to find a real pattern), but
 * cap how many can come from any single member so one prolific member cannot
 * fill every slot. This gives other members' *relevant* inspirations a chance to
 * be evidence without forcing in unrelated signals (which produced incoherent,
 * "unclear_pattern" judgments). Near-duplicate text is still skipped.
 */
function diversifyAcrossMembers(
  scored: WowMomentCandidate[],
  limit: number,
): WowMomentCandidate[] {
  if (limit <= 0) return [];
  // Allow at most ~half the slots to a single member.
  const perMemberCap = Math.max(2, Math.ceil(limit / 2));

  const counts = new Map<string, number>();
  const selected: WowMomentCandidate[] = [];
  const overflow: WowMomentCandidate[] = [];

  for (const candidate of scored) {
    if (selected.length >= limit) break;
    const isNearDuplicate = selected.some((existing) =>
      isNearDuplicateTopOfMindText(existing.inspiration.text, candidate.inspiration.text),
    );
    if (isNearDuplicate) continue;

    const uid = candidate.inspiration.userId;
    const used = counts.get(uid) ?? 0;
    if (used >= perMemberCap) {
      overflow.push(candidate);
      continue;
    }
    selected.push(candidate);
    counts.set(uid, used + 1);
  }

  // Backfill from the capped overflow (still score-ordered) if we're short.
  if (selected.length < limit) {
    selected.push(...overflow.slice(0, limit - selected.length));
  }
  return selected.slice(0, limit);
}

/**
 * Candidate pool for GROUP synthesis: already-embedded, SHARED inspirations
 * across the given member set (excluding the trigger). Private inspirations are
 * excluded here so they can never enter group synthesis.
 */
async function loadPooledCandidatePool(
  db: WakaDb,
  memberUserIds: string[],
  triggerInspirationId: string,
  triggerEmbedding: { model: string; dimensions: number; embedding: number[] },
  poolLimit: number,
) {
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
        inArray(inspirations.userId, memberUserIds),
        eq(inspirations.sharedToGroups, true),
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

  const candidates = rankAndDiversifyCandidates(trigger, candidatePool, limit);

  return { trigger: trigger.inspiration, candidates };
}

export interface FindGroupWowMomentCandidatesParams {
  memberUserIds: string[];
  triggerUserId: string;
  triggerInspirationId: string;
  limit?: number;
  db?: WakaDb;
}

/**
 * Group synthesis candidate retrieval: rank the trigger (owned by
 * `triggerUserId`) against the POOLED shared inspirations of every member. The
 * returned candidates may belong to different members — that cross-member pool
 * is exactly what makes a group note a genuine synthesis rather than a merge of
 * individual boards.
 */
export async function findGroupWowMomentCandidates(
  params: FindGroupWowMomentCandidatesParams,
): Promise<FindWowMomentCandidatesResult> {
  const db = params.db ?? getDb();
  const limit = normalizeLimit(params.limit);

  const trigger = await loadTriggerWithEmbedding(
    db,
    params.triggerUserId,
    params.triggerInspirationId,
  );
  if (!trigger || limit === 0 || params.memberUserIds.length === 0) {
    return { trigger: trigger?.inspiration ?? null, candidates: [] };
  }

  // Load the FULL shared member pool (capped at MAX_DB_CANDIDATE_POOL), not a
  // wow-score-truncated slice — otherwise members whose signals have low/zero
  // scores (e.g. never run through the personal scoring pipeline) get cut before
  // the cross-member diversity step and never appear as evidence.
  const candidatePool = await loadPooledCandidatePool(
    db,
    params.memberUserIds,
    params.triggerInspirationId,
    trigger.embedding,
    MAX_DB_CANDIDATE_POOL,
  );

  const candidates = diversifyAcrossMembers(scoreCandidates(trigger, candidatePool), limit);

  return { trigger: trigger.inspiration, candidates };
}
