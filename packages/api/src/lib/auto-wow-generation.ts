import { eq } from "drizzle-orm";

import { users } from "../db/index.js";
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
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";
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
      judgment: Extract<WowMomentJudgment, { isWowMoment: false }>;
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
}

export interface AutoWowGenerationParams extends AutoWowGenerationDependencies {
  db: WakaDb;
  userId: string;
  inspirationId: string;
  limit?: number;
  locale?: SupportedLocale;
}

async function loadUserPreferredLocale(
  db: WakaDb,
  userId: string,
): Promise<SupportedLocale> {
  const rows = await db
    .select({ preferredLocale: users.preferredLocale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return normalizeSupportedLocale(rows[0]?.preferredLocale);
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

    const locale = params.locale ?? (await loadUserPreferredLocale(params.db, params.userId));

    const judgment = await judgeWowMoment({
      db: params.db,
      userId: params.userId,
      triggerInspirationId: params.inspirationId,
      limit,
      locale,
    });

    if (judgment.isWowMoment === false) {
      return {
        status: "not_wow",
        generated: false,
        embeddingStatus: embeddingResult.status,
        judgment,
      };
    }

    const persisted = await persistJudgment({
      db: params.db,
      userId: params.userId,
      triggerInspirationId: params.inspirationId,
      judgment,
      limit,
      locale,
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
