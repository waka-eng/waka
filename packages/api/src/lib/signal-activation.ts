/**
 * Signal activation — DB glue for the spark engine's attention scheduler.
 *
 * The pure math lives in ../scoring/activation.ts. This module does three
 * things, all best-effort and all on the ops side of the vault line:
 *
 *   - pulseSignalActivation: a self event (revisit / reflection / edit)
 *     charges the signal itself; when its neighborhood has accumulated
 *     enough, the *existing* classification job is re-enqueued so the
 *     existing judge pipeline looks at it again.
 *   - spreadCaptureActivation: a new capture charges its semantic
 *     neighbors (spreading activation); when that pushes an old cluster
 *     over threshold, the warmest old signal is re-judged immediately via
 *     the caller-provided generator.
 *
 * Activation never decides meaning — it only decides *when to look again*.
 * The judge decides what is seen, the idempotent persist path dedupes what
 * is born, and nothing here is ever written to vault files.
 */

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import {
  inspirationEmbeddings,
  inspirations,
  signalActivations,
} from "../db/index.js";
import type { getDb } from "./db.js";
import {
  FIRE_CHECK_SELF_TRIP,
  FIRE_CONTRIBUTOR_SIMILARITY_FLOOR,
  chargeForEvent,
  decayedActivation,
  evaluateNeighborhoodFiring,
  foldActivationCharge,
  neighborCaptureCharge,
  shouldRunFireCheck,
  type ActivationChargeEvent,
  type ActivationState,
  type FiringEvaluation,
  type NeighborhoodMember,
} from "../scoring/activation.js";
import { cosineSimilarity } from "../scoring/wow-score.js";

type Db = ReturnType<typeof getDb>;

/** Same bound as every other retrieval in the pipeline. */
const NEIGHBOR_RETRIEVAL_LIMIT = 50;

/** Daily idempotency scope for convergence re-checks of one signal. */
export function convergenceIdempotencyScope(now: Date): string {
  return `convergence:${now.toISOString().slice(0, 10)}`;
}

async function upsertActivation(
  db: Db,
  input: { userId: string; inspirationId: string; state: ActivationState },
): Promise<{ lastFireCheckAt: Date | null }> {
  const rows = await db
    .insert(signalActivations)
    .values({
      userId: input.userId,
      inspirationId: input.inspirationId,
      activation: input.state.activation,
      activatedAt: input.state.activatedAt,
    })
    .onConflictDoUpdate({
      target: signalActivations.inspirationId,
      set: {
        activation: input.state.activation,
        activatedAt: input.state.activatedAt,
        updatedAt: input.state.activatedAt,
      },
    })
    .returning({ lastFireCheckAt: signalActivations.lastFireCheckAt });
  return { lastFireCheckAt: rows[0]?.lastFireCheckAt ?? null };
}

async function chargeActivation(
  db: Db,
  input: { userId: string; inspirationId: string; charge: number; now: Date },
): Promise<{ state: ActivationState; lastFireCheckAt: Date | null }> {
  const [existing] = await db
    .select({
      activation: signalActivations.activation,
      activatedAt: signalActivations.activatedAt,
    })
    .from(signalActivations)
    .where(
      and(
        eq(signalActivations.userId, input.userId),
        eq(signalActivations.inspirationId, input.inspirationId),
      ),
    )
    .limit(1);

  const state = foldActivationCharge(existing ?? null, input.charge, input.now);
  const { lastFireCheckAt } = await upsertActivation(db, {
    userId: input.userId,
    inspirationId: input.inspirationId,
    state,
  });
  return { state, lastFireCheckAt };
}

interface ActivationNeighborhood {
  /** Peers with a stored embedding of the trigger's model/dimensions. */
  peerCount: number;
  peers: Array<{
    inspirationId: string;
    similarity: number;
    state: ActivationState | null;
  }>;
}

/**
 * Bounded semantic neighborhood of one signal, decorated with stored
 * activation states. Mirrors the retrieval pattern of the local score
 * pipeline (same-model/dimensions filter, wow-score ordering, ≤50 rows,
 * app-side cosine); no provider calls, returns null without an embedding.
 */
export async function loadActivationNeighborhood(
  db: Db,
  input: { userId: string; inspirationId: string },
): Promise<ActivationNeighborhood | null> {
  const [triggerEmbedding] = await db
    .select()
    .from(inspirationEmbeddings)
    .where(
      and(
        eq(inspirationEmbeddings.userId, input.userId),
        eq(inspirationEmbeddings.inspirationId, input.inspirationId),
      ),
    )
    .limit(1);
  if (!triggerEmbedding) return null;

  const candidateRows = await db
    .select({ embedding: inspirationEmbeddings })
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
        eq(inspirationEmbeddings.userId, input.userId),
        ne(inspirationEmbeddings.inspirationId, input.inspirationId),
        eq(inspirationEmbeddings.model, triggerEmbedding.model),
        eq(inspirationEmbeddings.dimensions, triggerEmbedding.dimensions),
      ),
    )
    .orderBy(desc(inspirations.wowScore), desc(inspirations.createdAt))
    .limit(NEIGHBOR_RETRIEVAL_LIMIT);

  const scored = candidateRows
    .filter(
      ({ embedding }) =>
        embedding.embedding.length === triggerEmbedding.embedding.length,
    )
    .map(({ embedding }) => ({
      inspirationId: embedding.inspirationId,
      similarity: cosineSimilarity(triggerEmbedding.embedding, embedding.embedding),
    }));

  const activationRows = scored.length
    ? await db
        .select({
          inspirationId: signalActivations.inspirationId,
          activation: signalActivations.activation,
          activatedAt: signalActivations.activatedAt,
        })
        .from(signalActivations)
        .where(
          and(
            eq(signalActivations.userId, input.userId),
            inArray(
              signalActivations.inspirationId,
              scored.map((peer) => peer.inspirationId),
            ),
          ),
        )
    : [];
  const stateById = new Map(
    activationRows.map((row) => [
      row.inspirationId,
      { activation: row.activation, activatedAt: row.activatedAt },
    ]),
  );

  return {
    peerCount: scored.length,
    peers: scored.map((peer) => ({
      ...peer,
      state: stateById.get(peer.inspirationId) ?? null,
    })),
  };
}

export interface PulseResult {
  activation: number;
  fired: boolean;
  evaluation: FiringEvaluation | null;
}

/**
 * Self event: fold the charge, and — only when the signal is warm enough
 * and its cooldown has passed — evaluate the neighborhood. On firing, the
 * existing classification job is re-enqueued (daily-deduped), which reruns
 * the existing judge pipeline with today's fuller archive.
 */
export async function pulseSignalActivation(
  db: Db,
  input: {
    userId: string;
    inspirationId: string;
    event: ActivationChargeEvent;
    enqueueClassificationJob: (
      inspirationId: string,
      userId: string,
      options?: { idempotencyScope?: string },
    ) => Promise<unknown>;
    now?: Date;
  },
): Promise<PulseResult> {
  const now = input.now ?? new Date();
  const { state, lastFireCheckAt } = await chargeActivation(db, {
    userId: input.userId,
    inspirationId: input.inspirationId,
    charge: chargeForEvent(input.event),
    now,
  });

  if (state.activation < FIRE_CHECK_SELF_TRIP) {
    return { activation: state.activation, fired: false, evaluation: null };
  }
  if (!shouldRunFireCheck(lastFireCheckAt, now)) {
    return { activation: state.activation, fired: false, evaluation: null };
  }

  const neighborhood = await loadActivationNeighborhood(db, input);
  if (!neighborhood) {
    return { activation: state.activation, fired: false, evaluation: null };
  }

  const members: NeighborhoodMember[] = [
    // The trigger itself is part of its neighborhood (similarity 1).
    { ...state, similarityToTrigger: 1 },
    ...neighborhood.peers
      .filter((peer) => peer.state !== null)
      .map((peer) => ({ ...peer.state!, similarityToTrigger: peer.similarity })),
  ];
  const evaluation = evaluateNeighborhoodFiring({
    members,
    peerCount: neighborhood.peerCount,
    now,
  });

  await db
    .update(signalActivations)
    .set({ lastFireCheckAt: now, updatedAt: now })
    .where(
      and(
        eq(signalActivations.userId, input.userId),
        eq(signalActivations.inspirationId, input.inspirationId),
      ),
    );

  if (evaluation.fired) {
    await input.enqueueClassificationJob(input.inspirationId, input.userId, {
      idempotencyScope: convergenceIdempotencyScope(now),
    });
  }

  return { activation: state.activation, fired: evaluation.fired, evaluation };
}

export interface SpreadResult {
  chargedCount: number;
  fired: boolean;
  /** The warmest accumulated old signal, re-judged when firing. */
  rejudgedInspirationId: string | null;
  evaluation: FiringEvaluation;
}

/**
 * Capture event: spread charge to semantic neighbors, then check whether
 * the accumulated cluster fires. On firing, the warmest contributor — an
 * old signal the user never saw as important — is re-judged immediately
 * through the caller-provided generator (the classifier's existing
 * auto-generation seam), cooldown-guarded per signal per day.
 */
export async function spreadCaptureActivation(
  db: Db,
  input: {
    userId: string;
    inspirationId: string;
    generateForInspiration: (inspirationId: string) => Promise<unknown>;
    now?: Date;
  },
): Promise<SpreadResult | null> {
  const now = input.now ?? new Date();
  const neighborhood = await loadActivationNeighborhood(db, input);
  if (!neighborhood) return null;

  const charged: Array<{
    inspirationId: string;
    similarity: number;
    state: ActivationState;
    lastFireCheckAt: Date | null;
  }> = [];
  for (const peer of neighborhood.peers) {
    if (peer.similarity < FIRE_CONTRIBUTOR_SIMILARITY_FLOOR) continue;
    const state = foldActivationCharge(
      peer.state,
      neighborCaptureCharge(peer.similarity),
      now,
    );
    const { lastFireCheckAt } = await upsertActivation(db, {
      userId: input.userId,
      inspirationId: peer.inspirationId,
      state,
    });
    charged.push({ inspirationId: peer.inspirationId, similarity: peer.similarity, state, lastFireCheckAt });
  }

  const evaluation = evaluateNeighborhoodFiring({
    members: charged.map((peer) => ({
      ...peer.state,
      similarityToTrigger: peer.similarity,
    })),
    peerCount: neighborhood.peerCount,
    now,
  });

  let rejudgedInspirationId: string | null = null;
  if (evaluation.fired) {
    const warmest = [...charged].sort(
      (a, b) =>
        decayedActivation(b.state, now) * b.similarity -
        decayedActivation(a.state, now) * a.similarity,
    )[0];
    if (warmest && shouldRunFireCheck(warmest.lastFireCheckAt, now)) {
      await db
        .update(signalActivations)
        .set({ lastFireCheckAt: now, updatedAt: now })
        .where(
          and(
            eq(signalActivations.userId, input.userId),
            eq(signalActivations.inspirationId, warmest.inspirationId),
          ),
        );
      await input.generateForInspiration(warmest.inspirationId);
      rejudgedInspirationId = warmest.inspirationId;
    }
  }

  return {
    chargedCount: charged.length,
    fired: evaluation.fired,
    rejudgedInspirationId,
    evaluation,
  };
}
