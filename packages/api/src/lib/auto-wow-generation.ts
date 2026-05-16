import {
  ensureInspirationEmbedding,
  type EnsureInspirationEmbeddingResult,
  type WakaDb,
} from "./inspiration-embeddings.js";
import { persistLocalInspirationScoresById } from "./inspiration-scores.js";
import {
  judgeWowMomentForInspiration,
  persistWowMomentForInspirationJudgment,
  type PersistWowMomentForInspirationResult,
  type WowMomentJudgment,
} from "./wow-judge.js";
import {
  findWowMomentCandidates,
  type FindWowMomentCandidatesResult,
} from "./wow-candidates.js";
import { DEFAULT_WOW_GENERATION_LIMIT } from "./wow-generation-config.js";

export type AutoWowGenerationStatus =
  | "generated"
  | "existing"
  | "not_wow"
  | "stale_source"
  | "missing_inspiration"
  | "unavailable";

export type AutoWowGenerationResult =
  | {
      status: "generated" | "existing";
      generated: boolean;
      embeddingStatus: Exclude<EnsureInspirationEmbeddingResult["status"], "missing_inspiration" | "stale_source">;
      judgment: Extract<WowMomentJudgment, { isWowMoment: true }>;
      wowMoment: Extract<PersistWowMomentForInspirationResult, { persisted: true }>["wowMoment"];
      inspirationLinks: Extract<
        PersistWowMomentForInspirationResult,
        { persisted: true }
      >["inspirationLinks"];
    }
  | {
      status: "not_wow";
      generated: false;
      embeddingStatus: Exclude<EnsureInspirationEmbeddingResult["status"], "missing_inspiration" | "stale_source">;
      judgment: WowMomentJudgment;
    }
  | {
      status: "stale_source" | "missing_inspiration" | "unavailable";
      generated: false;
      embeddingStatus?: EnsureInspirationEmbeddingResult["status"];
    };

export interface AutoWowGenerationDependencies {
  ensureEmbedding?: typeof ensureInspirationEmbedding;
  judgeWowMoment?: typeof judgeWowMomentForInspiration;
  persistJudgment?: typeof persistWowMomentForInspirationJudgment;
  findCandidates?: typeof findWowMomentCandidates;
}

const MIN_ORGANIC_FALLBACK_CANDIDATE_SCORE = 0.32;
const FALLBACK_TITLE_MAX_WORDS = 10;

function summarizeFallbackTitle(triggerText: string, candidateText: string): string {
  const words = `${triggerText} ${candidateText}`
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, FALLBACK_TITLE_MAX_WORDS);
  return words.length > 0 ? `Connection: ${words.join(" ")}` : "Connection across recent inspirations";
}

function buildOrganicFallbackJudgment(
  retrieved: FindWowMomentCandidatesResult,
): Extract<WowMomentJudgment, { isWowMoment: true }> | null {
  if (!retrieved.trigger || retrieved.candidates.length === 0) return null;

  const [topCandidate] = retrieved.candidates;
  if (
    topCandidate.scores.runtimeCandidateScore < MIN_ORGANIC_FALLBACK_CANDIDATE_SCORE
  ) {
    return null;
  }

  const relatedInspirationIds = [topCandidate.inspiration.id];
  const triggerCluster = retrieved.trigger.cluster;
  const candidateCluster = topCandidate.inspiration.cluster;
  const kind =
    triggerCluster && candidateCluster && triggerCluster !== candidateCluster
      ? "bridge"
      : "recurrence";

  return {
    isWowMoment: true,
    kind,
    title: summarizeFallbackTitle(retrieved.trigger.text, topCandidate.inspiration.text),
    why:
      kind === "bridge"
        ? "These inspirations look connected across different clusters. This local fallback is intentionally bounded to retrieved tenant-scoped candidates."
        : "These inspirations repeat a similar signal in a small archive. This local fallback is intentionally bounded to retrieved tenant-scoped candidates.",
    relatedInspirationIds,
  };
}

export interface AutoWowGenerationParams extends AutoWowGenerationDependencies {
  db: WakaDb;
  userId: string;
  inspirationId: string;
  limit?: number;
}

/**
 * Best-effort automatic WOW generation for a freshly captured inspiration.
 *
 * This intentionally reuses the same bounded embedding → candidate judge →
 * persistence path as manual generation. The async classifier worker invokes
 * this after capture once classification reaches a success/permanent-skip
 * outcome. Provider/runtime failures are collapsed into `unavailable` so
 * neither the original inspiration save nor classifier batch success is
 * affected; tenant scoping and duplicate handling stay inside the existing
 * lower-level helpers.
 */
export async function generateAutoWowMomentForInspiration(
  params: AutoWowGenerationParams,
): Promise<AutoWowGenerationResult> {
  const ensureEmbedding = params.ensureEmbedding ?? ensureInspirationEmbedding;
  const judgeWowMoment = params.judgeWowMoment ?? judgeWowMomentForInspiration;
  const persistJudgment = params.persistJudgment ?? persistWowMomentForInspirationJudgment;
  const findCandidates = params.findCandidates ?? findWowMomentCandidates;
  const limit = params.limit ?? DEFAULT_WOW_GENERATION_LIMIT;

  try {
    const embeddingResult = await ensureEmbedding({
      db: params.db,
      userId: params.userId,
      inspirationId: params.inspirationId,
    });

    if (embeddingResult.status === "missing_inspiration") {
      return {
        status: "missing_inspiration",
        generated: false,
        embeddingStatus: embeddingResult.status,
      };
    }

    if (embeddingResult.status === "stale_source") {
      return {
        status: "stale_source",
        generated: false,
        embeddingStatus: embeddingResult.status,
      };
    }

    try {
      await persistLocalInspirationScoresById(params.db, {
        userId: params.userId,
        inspirationId: params.inspirationId,
      });
    } catch {
      // Score refresh is best-effort. It should never block automatic WOW
      // generation or turn a successful capture pipeline into an unavailable
      // result.
    }

    const judgment = await judgeWowMoment({
      db: params.db,
      userId: params.userId,
      triggerInspirationId: params.inspirationId,
      limit,
    });

    if (!judgment.isWowMoment) {
      let fallbackJudgment: Extract<WowMomentJudgment, { isWowMoment: true }> | null = null;
      try {
        fallbackJudgment = buildOrganicFallbackJudgment(
          await findCandidates({
            db: params.db,
            userId: params.userId,
            triggerInspirationId: params.inspirationId,
            limit,
          }),
        );
      } catch {
        // Candidate lookup is only a less-conservative organic fallback. If it
        // cannot run, preserve the original safe not_wow outcome instead of
        // turning a valid capture into an unavailable pipeline.
      }

      if (!fallbackJudgment) {
        return {
          status: "not_wow",
          generated: false,
          embeddingStatus: embeddingResult.status,
          judgment,
        };
      }

      const fallbackPersisted = await persistJudgment({
        db: params.db,
        userId: params.userId,
        triggerInspirationId: params.inspirationId,
        judgment: fallbackJudgment,
        limit,
      });

      if (fallbackPersisted.persisted === false) {
        return {
          status:
            fallbackPersisted.reason === "trigger_not_found"
              ? "missing_inspiration"
              : "not_wow",
          generated: false,
          embeddingStatus: embeddingResult.status,
          ...(fallbackPersisted.reason === "not_wow_moment"
            ? { judgment: fallbackPersisted.judgment }
            : {}),
        } as AutoWowGenerationResult;
      }

      return {
        status: fallbackPersisted.status === "existing" ? "existing" : "generated",
        generated: fallbackPersisted.status === "created",
        embeddingStatus: embeddingResult.status,
        judgment: fallbackPersisted.judgment,
        wowMoment: fallbackPersisted.wowMoment,
        inspirationLinks: fallbackPersisted.inspirationLinks,
      };
    }

    const persisted = await persistJudgment({
      db: params.db,
      userId: params.userId,
      triggerInspirationId: params.inspirationId,
      judgment,
      limit,
    });

    if (persisted.persisted === false) {
      return {
        status:
          persisted.reason === "trigger_not_found" ? "missing_inspiration" : "not_wow",
        generated: false,
        embeddingStatus: embeddingResult.status,
        ...(persisted.reason === "not_wow_moment" ? { judgment: persisted.judgment } : {}),
      } as AutoWowGenerationResult;
    }

    return {
      status: persisted.status === "existing" ? "existing" : "generated",
      generated: persisted.status === "created",
      embeddingStatus: embeddingResult.status,
      judgment: persisted.judgment,
      wowMoment: persisted.wowMoment,
      inspirationLinks: persisted.inspirationLinks,
    };
  } catch {
    return { status: "unavailable", generated: false };
  }
}
