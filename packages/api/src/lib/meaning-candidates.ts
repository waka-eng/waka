/**
 * Candidate retrieval for meaning-graph judgment.
 *
 * This is deliberately retrieval-only: no LLM call, no graph write, no runtime
 * scores persisted. It reuses the existing WOW candidate selector when stored
 * embeddings are available, then returns compact signal packets so downstream
 * judges do not need to read full artifacts.
 */

import { and, desc, eq, ne } from "drizzle-orm";

import {
  inspirations,
  meaningPackets,
  type Inspiration,
  type MeaningPacket,
} from "../db/index.js";
import {
  calculateRuntimeCandidateScore,
  clamp01,
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
import {
  findWowMomentCandidates,
  MAX_DB_CANDIDATE_POOL,
  type WowMomentCandidate,
} from "./wow-candidates.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const FALLBACK_POOL_MULTIPLIER = 4;
const RECENCY_SIGNAL_MAX_DAYS = 30;
const TIME_DISTANCE_MAX_DAYS = 365;

type CandidateSource = "embedding_similarity" | "durable_signal";

type CandidateInspiration = Pick<
  Inspiration,
  | "id"
  | "userId"
  | "kind"
  | "category"
  | "cluster"
  | "importanceScore"
  | "wowScore"
  | "createdAt"
  | "updatedAt"
>;

type CandidatePacket = Pick<
  MeaningPacket,
  | "id"
  | "inspirationId"
  | "primarySparkId"
  | "sparkText"
  | "artifactExcerpt"
  | "packetText"
  | "sourceMetadata"
  | "classifierSnapshot"
  | "inputFingerprint"
  | "tokenEstimate"
  | "updatedAt"
>;

export interface FindMeaningPacketCandidatesParams {
  userId: string;
  triggerInspirationId: string;
  limit?: number;
  db?: WakaDb;
}

export interface MeaningPacketCandidateScoreBreakdown {
  source: CandidateSource;
  /** Existing WAKA runtime ranking score, when embedding retrieval is available. */
  runtimeCandidateScore: RuntimeCandidateScore;
  /** Final request-time rank used by this helper; never persisted. */
  runtimeMeaningCandidateScore: RuntimeCandidateScore;
  persistedWowScore: WowScore;
  similarityScoreToTrigger: SimilarityScore | null;
  surpriseSimilarityScoreToTrigger: SurpriseSimilarityScore | null;
  timeDistanceScoreToTrigger: TimeSignalScore;
  recencyScore: TimeSignalScore;
}

export interface MeaningPacketCandidate {
  inspiration: CandidateInspiration;
  packet: CandidatePacket;
  scores: MeaningPacketCandidateScoreBreakdown;
}

export interface FindMeaningPacketCandidatesResult {
  trigger: {
    inspiration: CandidateInspiration;
    packet: CandidatePacket;
  } | null;
  candidates: MeaningPacketCandidate[];
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_LIMIT)) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
}

function fallbackPoolLimit(limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(
    MAX_DB_CANDIDATE_POOL,
    Math.max(limit * FALLBACK_POOL_MULTIPLIER, limit + 20),
  );
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function calculateTimeDistanceScore(a: Date, b: Date): TimeSignalScore {
  return logNormalize(daysBetween(a, b), { max: TIME_DISTANCE_MAX_DAYS });
}

function calculateRecencyScore(createdAt: Date, now: Date): TimeSignalScore {
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  return clamp01(1 - ageDays / RECENCY_SIGNAL_MAX_DAYS);
}

function meaningCandidateScore(input: {
  runtimeCandidateScore: RuntimeCandidateScore;
  persistedWowScore: WowScore;
  timeDistanceScoreToTrigger: TimeSignalScore;
  recencyScore: TimeSignalScore;
}): RuntimeCandidateScore {
  return clamp01(
    0.55 * input.runtimeCandidateScore +
      0.2 * input.persistedWowScore +
      0.15 * input.timeDistanceScoreToTrigger +
      0.1 * input.recencyScore,
  );
}

function inspirationShape(inspiration: CandidateInspiration): CandidateInspiration {
  return {
    id: inspiration.id,
    userId: inspiration.userId,
    kind: inspiration.kind,
    category: inspiration.category,
    cluster: inspiration.cluster,
    importanceScore: inspiration.importanceScore,
    wowScore: inspiration.wowScore,
    createdAt: inspiration.createdAt,
    updatedAt: inspiration.updatedAt,
  };
}

function packetShape(packet: MeaningPacket): CandidatePacket {
  return {
    id: packet.id,
    inspirationId: packet.inspirationId,
    primarySparkId: packet.primarySparkId,
    sparkText: packet.sparkText,
    artifactExcerpt: packet.artifactExcerpt,
    packetText: packet.packetText,
    sourceMetadata: packet.sourceMetadata,
    classifierSnapshot: packet.classifierSnapshot,
    inputFingerprint: packet.inputFingerprint,
    tokenEstimate: packet.tokenEstimate,
    updatedAt: packet.updatedAt,
  };
}

async function loadTriggerPacket(
  db: WakaDb,
  userId: string,
  inspirationId: string,
) {
  const [row] = await db
    .select({ inspiration: inspirations, packet: meaningPackets })
    .from(meaningPackets)
    .innerJoin(
      inspirations,
      and(
        eq(inspirations.id, meaningPackets.inspirationId),
        eq(inspirations.userId, meaningPackets.userId),
      ),
    )
    .where(
      and(
        eq(meaningPackets.userId, userId),
        eq(meaningPackets.inspirationId, inspirationId),
        eq(inspirations.userId, userId),
        eq(inspirations.id, inspirationId),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function loadPacketByInspirationId(
  db: WakaDb,
  userId: string,
  inspirationId: string,
): Promise<MeaningPacket | null> {
  const [packet] = await db
    .select()
    .from(meaningPackets)
    .where(
      and(
        eq(meaningPackets.userId, userId),
        eq(meaningPackets.inspirationId, inspirationId),
      ),
    )
    .limit(1);

  return packet ?? null;
}

async function loadFallbackPacketPool(
  db: WakaDb,
  userId: string,
  triggerInspirationId: string,
  poolLimit: number,
) {
  if (poolLimit <= 0) return [];

  return db
    .select({ inspiration: inspirations, packet: meaningPackets })
    .from(meaningPackets)
    .innerJoin(
      inspirations,
      and(
        eq(inspirations.id, meaningPackets.inspirationId),
        eq(inspirations.userId, meaningPackets.userId),
      ),
    )
    .where(
      and(
        eq(meaningPackets.userId, userId),
        eq(inspirations.userId, userId),
        ne(meaningPackets.inspirationId, triggerInspirationId),
      ),
    )
    .orderBy(desc(inspirations.wowScore), desc(inspirations.createdAt))
    .limit(poolLimit);
}

function candidateFromWowCandidate(input: {
  wowCandidate: WowMomentCandidate;
  packet: MeaningPacket;
  now: Date;
}): MeaningPacketCandidate {
  const persistedWowScore = input.wowCandidate.scores.persistedWowScore;
  const timeDistanceScoreToTrigger = input.wowCandidate.scores.timeDistanceScoreToTrigger;
  const recencyScore = calculateRecencyScore(input.wowCandidate.inspiration.createdAt, input.now);
  const runtimeMeaningCandidateScore = meaningCandidateScore({
    runtimeCandidateScore: input.wowCandidate.scores.runtimeCandidateScore,
    persistedWowScore,
    timeDistanceScoreToTrigger,
    recencyScore,
  });

  return {
    inspiration: inspirationShape(input.wowCandidate.inspiration),
    packet: packetShape(input.packet),
    scores: {
      source: "embedding_similarity",
      runtimeCandidateScore: input.wowCandidate.scores.runtimeCandidateScore,
      runtimeMeaningCandidateScore,
      persistedWowScore,
      similarityScoreToTrigger: input.wowCandidate.scores.similarityScoreToTrigger,
      surpriseSimilarityScoreToTrigger:
        input.wowCandidate.scores.surpriseSimilarityScoreToTrigger,
      timeDistanceScoreToTrigger,
      recencyScore,
    },
  };
}

function candidateFromFallback(input: {
  triggerCreatedAt: Date;
  inspiration: CandidateInspiration;
  packet: MeaningPacket;
  now: Date;
}): MeaningPacketCandidate {
  const persistedWowScore = fromPersistedScore(input.inspiration.wowScore);
  const timeDistanceScoreToTrigger = calculateTimeDistanceScore(
    input.triggerCreatedAt,
    input.inspiration.createdAt,
  );
  const recencyScore = calculateRecencyScore(input.inspiration.createdAt, input.now);
  const runtimeCandidateScore = clamp01(
    0.55 * persistedWowScore +
      0.25 * timeDistanceScoreToTrigger +
      0.2 * recencyScore,
  );
  const runtimeMeaningCandidateScore = meaningCandidateScore({
    runtimeCandidateScore,
    persistedWowScore,
    timeDistanceScoreToTrigger,
    recencyScore,
  });

  return {
    inspiration: inspirationShape(input.inspiration),
    packet: packetShape(input.packet),
    scores: {
      source: "durable_signal",
      runtimeCandidateScore,
      runtimeMeaningCandidateScore,
      persistedWowScore,
      similarityScoreToTrigger: null,
      surpriseSimilarityScoreToTrigger: null,
      timeDistanceScoreToTrigger,
      recencyScore,
    },
  };
}

function mergeCandidates(candidates: MeaningPacketCandidate[]): MeaningPacketCandidate[] {
  const byInspirationId = new Map<string, MeaningPacketCandidate>();

  for (const candidate of candidates) {
    const existing = byInspirationId.get(candidate.inspiration.id);
    if (
      !existing ||
      candidate.scores.runtimeMeaningCandidateScore >
        existing.scores.runtimeMeaningCandidateScore ||
      (candidate.scores.runtimeMeaningCandidateScore ===
        existing.scores.runtimeMeaningCandidateScore &&
        candidate.scores.source === "embedding_similarity")
    ) {
      byInspirationId.set(candidate.inspiration.id, candidate);
    }
  }

  return [...byInspirationId.values()].sort((a, b) => {
    const scoreDelta =
      b.scores.runtimeMeaningCandidateScore -
      a.scores.runtimeMeaningCandidateScore;
    if (scoreDelta !== 0) return scoreDelta;

    return b.inspiration.createdAt.getTime() - a.inspiration.createdAt.getTime();
  });
}

/**
 * Return compact signal packets worth judging against a trigger inspiration.
 *
 * The trigger and every candidate are tenant-scoped. The helper caps DB
 * preselection and final results, and it never reads unrelated full artifacts
 * into memory for an LLM prompt.
 */
export async function findMeaningPacketCandidates(
  params: FindMeaningPacketCandidatesParams,
): Promise<FindMeaningPacketCandidatesResult> {
  const db = params.db ?? getDb();
  const limit = normalizeLimit(params.limit);
  const trigger = await loadTriggerPacket(
    db,
    params.userId,
    params.triggerInspirationId,
  );

  if (!trigger) return { trigger: null, candidates: [] };
  if (limit === 0) {
    return {
      trigger: {
        inspiration: inspirationShape(trigger.inspiration),
        packet: packetShape(trigger.packet),
      },
      candidates: [],
    };
  }

  const now = new Date();
  const embedded = await findWowMomentCandidates({
    db,
    userId: params.userId,
    triggerInspirationId: params.triggerInspirationId,
    limit,
  });

  const embeddedCandidates: MeaningPacketCandidate[] = [];
  for (const wowCandidate of embedded.candidates) {
    const packet = await loadPacketByInspirationId(
      db,
      params.userId,
      wowCandidate.inspiration.id,
    );
    if (!packet) continue;
    embeddedCandidates.push(
      candidateFromWowCandidate({
        wowCandidate,
        packet,
        now,
      }),
    );
  }

  const fallbackRows = await loadFallbackPacketPool(
    db,
    params.userId,
    params.triggerInspirationId,
    fallbackPoolLimit(limit),
  );
  const fallbackCandidates = fallbackRows.map(({ inspiration, packet }) =>
    candidateFromFallback({
      triggerCreatedAt: trigger.inspiration.createdAt,
      inspiration,
      packet,
      now,
    }),
  );

  return {
    trigger: {
      inspiration: inspirationShape(trigger.inspiration),
      packet: packetShape(trigger.packet),
    },
    candidates: mergeCandidates([...embeddedCandidates, ...fallbackCandidates]).slice(
      0,
      limit,
    ),
  };
}
