/**
 * A signal's vector — the only four things that ever happen to one.
 *
 * A signal's vector is its statement's vector, and match-or-mint compares
 * every incoming candidate against these rows. That makes a stale vector a
 * correctness problem rather than a cache miss: a vector describing wording a
 * signal no longer carries goes on winning matches, and every match it wins
 * attaches evidence to the wrong thing. So writing, dropping and re-embedding
 * are gathered here, where the invariant can be stated once instead of being
 * re-argued at each call site.
 *
 * Two of these spend the shared model key and two do not, and the difference
 * decides where they may be called from. `dropSignalEmbedding` is a delete —
 * cheap enough for a request handler. `reembedSignalStatement` and
 * `reembedSignal` call the embedding service, so they run from the queue,
 * where the per-account budget is enforced; `model-spend-stays-on-the-queue.test.ts`
 * names this file as their home and fails if a route so much as mentions them.
 */

import { and, eq } from "drizzle-orm";

import { signalEmbeddings, signals } from "../db/index.js";
import { getDb } from "./db.js";
import {
  GeminiEmbeddingHttpClient,
  hashEmbeddingInput,
} from "./inspiration-embeddings.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

/** Whatever can produce a vector for a statement, so tests need no network. */
export interface StatementEmbeddingClient {
  readonly model: string;
  embed(input: string): Promise<number[]>;
}

/**
 * A signal's vector is its statement's vector. Keyed by (signal, model) so a
 * restatement replaces the old vector rather than leaving match-or-mint
 * comparing against text the signal no longer says.
 */
export async function writeSignalEmbedding(
  tx: WakaTx,
  input: {
    profileId: string;
    signalId: string;
    statement: string;
    embedding: number[];
    model: string;
  },
): Promise<void> {
  await tx
    .insert(signalEmbeddings)
    .values({
      profileId: input.profileId,
      signalId: input.signalId,
      model: input.model,
      dimensions: input.embedding.length,
      inputHash: hashEmbeddingInput(input.statement),
      embedding: input.embedding,
    })
    .onConflictDoUpdate({
      target: [signalEmbeddings.signalId, signalEmbeddings.model],
      set: {
        dimensions: input.embedding.length,
        inputHash: hashEmbeddingInput(input.statement),
        embedding: input.embedding,
        updatedAt: new Date(),
      },
    });
}

/**
 * Forget what a signal used to mean.
 *
 * Cheap on purpose: a delete, no model call, safe to do inside a request. It
 * is what an edit route can afford, and it is the half of re-embedding that
 * cannot wait — a vector describing the owner's *previous* wording goes on
 * matching captures to a pattern they have just told us they no longer hold,
 * and every match it wins is evidence attached to the wrong thing.
 *
 * The state it leaves is the one this pipeline always prefers: with no vector
 * a signal is briefly not a match target, so a similar capture mints a visible
 * near-duplicate its owner can merge. Visible and recoverable, rather than
 * silent and wrong.
 */
export async function dropSignalEmbedding(
  db: WakaDb,
  input: { profileId: string; signalId: string },
): Promise<void> {
  await db
    .delete(signalEmbeddings)
    .where(
      and(
        eq(signalEmbeddings.profileId, input.profileId),
        eq(signalEmbeddings.signalId, input.signalId),
      ),
    );
}

/**
 * Bring a signal's stored vector back in line with its statement after a
 * human edit. Match-or-mint compares captures against these vectors, so a
 * signal whose owner rewrote it to mean something else must not keep matching
 * the old meaning and accruing evidence for a pattern it no longer names.
 *
 * This spends the shared model key, so it runs from the queue and nowhere
 * else — see `reembedSignal` below and the `reembed_signal` job type.
 *
 * On an embedding failure the stale row is removed rather than left wrong,
 * and the job is *not* failed for it. A throw would buy a retry that spends
 * two more metered starts to reach the same place the failure path already
 * reaches: no vector, and a near-duplicate the owner can merge.
 */
export async function reembedSignalStatement(
  db: WakaDb,
  input: { profileId: string; signalId: string; statement: string },
  deps: { embeddingClient?: StatementEmbeddingClient } = {},
): Promise<void> {
  const client = deps.embeddingClient ?? new GeminiEmbeddingHttpClient();
  try {
    const embedding = await client.embed(input.statement);
    await db
      .insert(signalEmbeddings)
      .values({
        profileId: input.profileId,
        signalId: input.signalId,
        model: client.model,
        dimensions: embedding.length,
        inputHash: hashEmbeddingInput(input.statement),
        embedding,
      })
      .onConflictDoUpdate({
        target: [signalEmbeddings.signalId, signalEmbeddings.model],
        set: {
          dimensions: embedding.length,
          inputHash: hashEmbeddingInput(input.statement),
          embedding,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn("[signals] re-embed after edit failed; dropping stale vector", {
      signalId: input.signalId,
      error: err instanceof Error ? err.message : String(err),
    });
    await dropSignalEmbedding(db, input);
  }
}

/**
 * The queue's entry point for a re-embedding: load the statement, then embed
 * it.
 *
 * The statement is read here rather than carried on the job for the reason
 * `ReembedSignalPayload` documents — a second edit joins the pending row
 * without rewriting its payload, so the only wording that can be trusted is
 * the one in the table at the moment the job runs. Reading it here also means
 * this job never has to be reconciled against a delete: a signal that is gone
 * simply has nothing to embed.
 */
export async function reembedSignal(
  input: { profileId: string; signalId: string },
  deps: { db?: WakaDb; embeddingClient?: StatementEmbeddingClient } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const [signal] = await db
    .select({ statement: signals.statement })
    .from(signals)
    .where(and(eq(signals.profileId, input.profileId), eq(signals.id, input.signalId)))
    .limit(1);

  // Edited, then deleted, before the queue got here. The cascade took the
  // vector with the signal; there is nothing left to describe.
  if (!signal) return;

  await reembedSignalStatement(
    db,
    { profileId: input.profileId, signalId: input.signalId, statement: signal.statement },
    deps,
  );
}
