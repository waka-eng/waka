import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { feedback, wowMomentInspirations, wowMoments } from "../db/index.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import {
  evaluateTopOfMindCandidate,
  type TopOfMindPersistenceAction,
} from "./top-of-mind-value.js";

export interface PersistTopOfMindRevisionInput {
  db: WakaDb;
  userId: string;
  semanticKey: string;
  evidenceFingerprint: string;
  evidenceIds: readonly string[];
  value: number;
  createRevision: (tx: WakaDb) => Promise<typeof wowMoments.$inferSelect>;
}

export interface PersistTopOfMindRevisionResult {
  action: TopOfMindPersistenceAction;
  note: typeof wowMoments.$inferSelect;
}

export async function lockTopOfMindFamily(
  tx: WakaDb,
  userId: string,
  semanticKey: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${semanticKey}`}))`,
  );
}

/**
 * Serializes evaluation per user/idea and owns retry, pin and replacement policy.
 * The advisory lock plus transaction make archive+insert one atomic operation.
 */
export async function persistTopOfMindRevision(
  input: PersistTopOfMindRevisionInput,
): Promise<PersistTopOfMindRevisionResult> {
  return input.db.transaction(async (tx) => {
    await lockTopOfMindFamily(tx, input.userId, input.semanticKey);

    const [generationMatch] = await tx
      .select()
      .from(wowMoments)
      .where(
        and(
          eq(wowMoments.userId, input.userId),
          eq(wowMoments.semanticKey, input.semanticKey),
          eq(wowMoments.evidenceFingerprint, input.evidenceFingerprint),
          eq(wowMoments.lifecycleStatus, "active"),
        ),
      )
      .orderBy(desc(wowMoments.createdAt))
      .limit(1);
    const [existing] = await tx
      .select()
      .from(wowMoments)
      .where(
        and(
          eq(wowMoments.userId, input.userId),
          eq(wowMoments.semanticKey, input.semanticKey),
          eq(wowMoments.lifecycleStatus, "active"),
        ),
      )
      .orderBy(desc(wowMoments.createdAt))
      .limit(1);

    let isPinned = false;
    let isSuppressedWithoutNewEvidence = false;
    if (existing) {
      const [[latestPinFeedback], [latestDispositionFeedback], baselineEvidence] =
        await Promise.all([
          tx
            .select({ value: feedback.value })
            .from(feedback)
            .where(
              and(
                eq(feedback.userId, input.userId),
                eq(feedback.targetType, "top_of_mind_note"),
                eq(feedback.targetId, existing.id),
                inArray(feedback.value, ["important", "not_important"]),
              ),
            )
            .orderBy(desc(feedback.createdAt), desc(feedback.id))
            .limit(1),
          tx
            .select({ value: feedback.value })
            .from(feedback)
            .where(
              and(
                eq(feedback.userId, input.userId),
                eq(feedback.targetType, "top_of_mind_note"),
                eq(feedback.targetId, existing.id),
              ),
            )
            .orderBy(desc(feedback.createdAt), desc(feedback.id))
            .limit(1),
          tx
            .select({ inspirationId: wowMomentInspirations.inspirationId })
            .from(wowMomentInspirations)
            .where(
              and(
                eq(wowMomentInspirations.userId, input.userId),
                eq(wowMomentInspirations.wowMomentId, existing.id),
              ),
            ),
        ]);
      isPinned = latestPinFeedback?.value === "important";
      const baselineEvidenceIds = new Set(
        baselineEvidence.map((row) => row.inspirationId),
      );
      const hasNewEvidence = [...new Set(input.evidenceIds)].some(
        (evidenceId) => !baselineEvidenceIds.has(evidenceId),
      );
      isSuppressedWithoutNewEvidence =
        latestDispositionFeedback?.value === "not_true" && !hasNewEvidence;
    }

    if (generationMatch)
      return { action: "keep_existing", note: generationMatch };
    if (existing && isPinned)
      return { action: "blocked_by_pin", note: existing };
    if (existing && isSuppressedWithoutNewEvidence)
      return { action: "keep_existing", note: existing };

    const action = evaluateTopOfMindCandidate({
      candidateValue: input.value,
      candidateEvidenceFingerprint: input.evidenceFingerprint,
      existing: existing
        ? {
            value: existing.wowScore,
            evidenceFingerprint: existing.evidenceFingerprint ?? "legacy",
            isPinned,
          }
        : undefined,
    });
    if (existing && action !== "replace") return { action, note: existing };

    if (existing) {
      await tx
        .update(wowMoments)
        .set({ lifecycleStatus: "replaced", replacedAt: new Date() })
        .where(
          and(
            eq(wowMoments.userId, input.userId),
            eq(wowMoments.id, existing.id),
          ),
        );
    }

    const created = await input.createRevision(tx);
    if (existing && created.id === existing.id) {
      throw new Error(
        "Top-of-mind replacement conflicted with the archived revision.",
      );
    }
    if (created.lifecycleStatus !== "active") {
      throw new Error(
        "Top-of-mind revision creation returned a non-active row.",
      );
    }
    if (
      created.userId !== input.userId ||
      created.semanticKey !== input.semanticKey ||
      created.evidenceFingerprint !== input.evidenceFingerprint
    ) {
      throw new Error(
        "Top-of-mind revision creation returned a mismatched identity.",
      );
    }
    if (existing) {
      await tx
        .update(wowMoments)
        .set({ replacedById: created.id })
        .where(
          and(
            eq(wowMoments.userId, input.userId),
            eq(wowMoments.id, existing.id),
          ),
        );
    }
    return { action: existing ? "replace" : "create", note: created };
  });
}
