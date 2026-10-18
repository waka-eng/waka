/**
 * Layer 2 — turning one inspiration into evidence for the profile's signals.
 *
 * The shape of a pass, per capture:
 *
 *   1. load the capture, its reflections, and its attachments' enrichment
 *   2. ask the provider for 0–3 candidate statements, each grounded in a span
 *   3. embed the capture (so layer-1 recall stays warm) and each candidate
 *   4. match-or-mint: cosine each candidate against the profile's existing
 *      signal vectors — above the bar it is evidence for that signal, below
 *      it is a new `emerging` signal
 *   5. recompute lifecycle in pure code: confidence, promotion, recency
 *
 * Only step 2 is a model call. Everything that decides what the profile ends
 * up holding is deterministic and testable without a network, which is what
 * makes the thresholds below tunable rather than mysterious.
 *
 * The lock rule is absolute: a signal whose `lockedAt` is set never has its
 * statement rewritten here. Evidence and confidence keep accruing to it — the
 * human's text is frozen, its support is not.
 *
 * Steps 1–3 are this file. The rest were carved out along those same seams,
 * because the pass had grown past the point where a reader could hold it:
 *
 *   - `signal-derivation-thresholds.ts` — every tuning number, plus
 *     `classifyMatch`, the function that reads two of them. Locked to
 *     docs/generation.md; that file's header explains how, and why it says so.
 *   - `signal-match-or-mint.ts` — step 4. Cosine decides; the one model call
 *     in it is a tie-breaker inside a band and can never overrule the number.
 *   - `signal-lifecycle.ts` — step 5, plus what becomes of a signal when its
 *     evidence is deleted. Arithmetic over rows; no model, no network.
 *   - `signal-embeddings.ts` — the signal-vector store: write, drop, and the
 *     re-embed a human edit triggers.
 *
 * This module re-exports all four with `export *`. That keeps every existing
 * import path working, and — the reason it is `export *` rather than a list of
 * names — it keeps the doc-lock test seeing the whole tuning surface. A named
 * re-export list silently narrows what that test can find; see the header of
 * `signal-derivation-thresholds.ts` for the failure it produced.
 */

import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import {
  inspirationEmbeddings,
  inspirations,
  profiles,
  signals,
} from "../db/index.js";
import { cosineSimilarity } from "../scoring/vector.js";
import { getDb } from "./db.js";
import {
  ensureInspirationEmbedding,
  GeminiEmbeddingHttpClient,
} from "./inspiration-embeddings.js";
import { normalizeSupportedLocale } from "./locales.js";
import { assertMaterialCurrent, loadInspirationMaterial, relatedMaterialIdentity, resolveMaterialQuote } from "./inspiration-material.js";
import { reviewSignalSupport, SupportSourceUnavailableError } from "./signal-support-review.js";
import { applySignalSupportReview } from "./signal-support-apply.js";
import { bindInspirationReading, finishInspirationDerivation, isInspirationDerivationRecorded, readInspirationRevision,
  type ClaimedDerivationRequest, type DerivationProcessingInput } from "./inspiration-processing.js";
import { enqueueTopOfMindRefresh, wakeCommittedBackgroundJobs } from "./queue.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
  type RelatedInspirationContext,
  type SignalCandidate,
} from "./model-provider.js";
import { quoteForEvidence } from "./salience.js";
import {
  MATCH_CANDIDATE_SCAN_LIMIT,
  RELATED_INSPIRATION_CONTEXT_LIMIT,
  RELATED_INSPIRATION_MIN_COSINE,
  RELATED_INSPIRATION_SCAN_LIMIT,
  SIGNAL_BATCH_DEDUPE_MIN_COSINE,
  MAX_EXISTING_CATEGORIES,
} from "./signal-derivation-thresholds.js";
import type { StatementEmbeddingClient } from "./signal-embeddings.js";
import {
  acquireSignalDerivationLock,
  applyCandidates,
  type ResolvedCandidate,
} from "./signal-match-or-mint.js";

export * from "./signal-derivation-thresholds.js";
export * from "./signal-embeddings.js";
export * from "./signal-lifecycle.js";
export * from "./signal-match-or-mint.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

// Bounds on what one candidate may carry into the database. Unexported on
// purpose: `signal-derivation-thresholds.ts` is machine-checked against
// docs/generation.md, so exporting these would enrol them in that lock and
// oblige the doc to carry three rows about string truncation. They belong
// beside `clip`, which is their only caller.
const MAX_STATEMENT_LENGTH = 500;
const MAX_QUOTE_LENGTH = 500;
const MAX_REASON_LENGTH = 500;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

export interface DeriveSignalsInput {
  inspirationId: string;
  /** "created" on capture, "edited" when a change re-derives the capture. */
  reason: "created" | "edited";
  /* Signals land on the inspiration's own profile, always. The room pass
     (`deriveIntoProfileId`, landing on a room's mind) retired with the room
     engine on 2026-10-17; the worker settles any queued one unrun. */
  /** Internal support job: review existing claims without discovering new ones. */
  supportOnly?: boolean;
}

export interface SignalDerivationDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  embeddingClient?: StatementEmbeddingClient;
  now?: Date;
  beforeCommit?: (tx: WakaTx) => Promise<void>;
  processingRequest?: ClaimedDerivationRequest;
}

export interface SignalDerivationResult {
  status: "derived" | "missing_inspiration" | "no_candidates";
  inspirationId: string;
  profileId: string | null;
  candidateCount: number;
  /** Existing signals this capture became evidence for. */
  matchedSignalIds: string[];
  /** Signals minted because nothing the profile held was close enough. */
  mintedSignalIds: string[];
  /** Signals that crossed the evidence bar into `active` on this pass. */
  promotedSignalIds: string[];
  supportReview?: { checked: number; withdrawn: number; restored: number; unresolved: number; retryable: boolean };
}

/**
 * Derive signals for one inspiration.
 *
 * Returns rather than throws for the two ordinary "nothing to do" outcomes —
 * the capture was deleted while the job waited, or it carries no durable
 * pattern. Both are correct states, not failures, and a queue that retries
 * them three times learns nothing on attempts two and three.
 */
export async function deriveSignalsForInspiration(
  input: DeriveSignalsInput,
  deps: SignalDerivationDependencies = {},
): Promise<SignalDerivationResult> {
  const db = deps.db ?? getDb();
  if (input.supportOnly && deps.processingRequest) throw new Error('Support-only work cannot certify source derivation');
  const now = deps.now ?? new Date();

  const [inspirationRow] = await db
    .select()
    .from(inspirations)
    .where(eq(inspirations.id, input.inspirationId))
    .limit(1);

  if (!inspirationRow) {
    return {
      status: "missing_inspiration",
      inspirationId: input.inspirationId,
      profileId: null,
      candidateCount: 0,
      matchedSignalIds: [],
      mintedSignalIds: [],
      promotedSignalIds: [],
    };
  }

  /* THE DERIVING PROFILE IS WHERE SIGNALS LAND — the inspiration's own
     owner. Everything downstream of extraction keys off it: the
     existing-statement scan, the match targets, the advisory lock, the mint. */
  const profileId = inspirationRow.profileId;
  let supportReview: SignalDerivationResult["supportReview"];
  let reviewedMaterialHash: string | null = null;
  const emptyResult = (status: SignalDerivationResult["status"]): SignalDerivationResult => ({
    status, inspirationId: inspirationRow.id, profileId, candidateCount: 0,
    matchedSignalIds: [], mintedSignalIds: [], promotedSignalIds: [], supportReview,
  });
  const processingInput = (materialRevision: string | undefined): DerivationProcessingInput => {
    if (!materialRevision || !deps.processingRequest) throw new Error("Source processing requires a material revision and claimed request");
    return { profileId, ownerProfileId: inspirationRow.profileId, inspirationId: inspirationRow.id,
      materialRevision, request: deps.processingRequest };
  };
  const requestReading = (tx: WakaTx) => enqueueTopOfMindRefresh(profileId, "signals_changed", tx);
  if (deps.processingRequest) {
    const revision = await readInspirationRevision(db, inspirationRow.profileId, inspirationRow.id, "personal");
    if (revision && await isInspirationDerivationRecorded(db, processingInput(revision.toString()))) {
      const material = await loadInspirationMaterial(db, inspirationRow.profileId, inspirationRow.id, "personal");
      if (!material || material.identity.revision !== revision.toString()) throw new Error("Source material changed before processing recovery");
      await db.transaction(async (tx) => {
        await acquireSignalDerivationLock(tx, profileId);
        await assertMaterialCurrent(tx, material, []);
        await deps.beforeCommit?.(tx);
        await finishInspirationDerivation(tx, processingInput(revision.toString()), { complete: true, requestReading: () => requestReading(tx) });
      });
      await wakeCommittedBackgroundJobs();
      return emptyResult("no_candidates");
    }
  }
  const provider = deps.modelProvider ?? (await getDefaultModelProvider());
  // Planning large-source coverage reads the source too; a source deleted
  // mid-run is the same ordinary outcome as below, not a retryable fault.
  try {
    if (deps.beforeCommit) await (await import('./signal-support-batches.js')).ensureSupportBatchCoverage(db, {
      ownerProfileId: inspirationRow.profileId, inspirationId: inspirationRow.id,
      provider, beforeCommit: deps.beforeCommit,
    });
  } catch (error) {
    if (error instanceof SupportSourceUnavailableError) return emptyResult(error.status);
    throw error;
  }
  const embeddingClient = deps.embeddingClient ?? new GeminiEmbeddingHttpClient();

  // Existing support is its own question, before bounded discovery. Applying
  // it rechecks current inputs under locks and persists any reading request.
  // A later extraction failure cannot lose the committed correction.
  try {
    const review = await reviewSignalSupport(db, { ownerProfileId: inspirationRow.profileId,
      inspirationId: inspirationRow.id,
      provider, maxCalls: 1, reuseCurrentAssessments: true });
    if (review.status !== "current") throw new Error("Source material changed during support assessment");
    reviewedMaterialHash = review.material.hash;
    const applied = review.calls > 0 ? await applySignalSupportReview(db, review, { beforeCommit: deps.beforeCommit,
      onReadingRequested: deps.processingRequest ? (tx, job) => bindInspirationReading(tx, processingInput(review.material.revision), job) : undefined }) : null;
    supportReview = { checked: review.items.length, withdrawn: applied?.withdrawn.length ?? 0,
      restored: applied?.restored.length ?? 0, unresolved: review.items.filter((item) => item.verdict === "unresolved").length,
      retryable: review.items.some((item) => item.issue !== undefined) };
  } catch (error) {
    if (error instanceof SupportSourceUnavailableError) return emptyResult(error.status);
    throw error;
  }
  const material = await loadInspirationMaterial(db, inspirationRow.profileId, inspirationRow.id, "personal");
  if (!material) return emptyResult("missing_inspiration");
  if (material.identity.hash !== reviewedMaterialHash) throw new Error("Source material changed after support assessment");
  const inspiration = material.inspiration;
  const reflectionRows = material.reflectionRows;
  const attachmentRows = material.attachmentRows.filter((row) => row.status === "ready" && row.text !== null)
    .map(({ id, kind, text, hostname, name }) => ({ id, kind, text, hostname, name }));
  if (input.supportOnly) {
    await db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx, profileId);
      await assertMaterialCurrent(tx, material, []);
      await deps.beforeCommit?.(tx);
    });
    await wakeCommittedBackgroundJobs();
    return emptyResult('no_candidates');
  }
  const [profileRows, existingStatements, existingCategories] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1),
    db
      .select({ id: signals.id, statement: signals.statement })
      .from(signals)
      .where(
        and(
          eq(signals.profileId, profileId),
          inArray(signals.status, ["emerging", "active"]),
        ),
      )
      .orderBy(desc(signals.lastEvidenceAt))
      .limit(MATCH_CANDIDATE_SCAN_LIMIT),
    /* THE SHELVES THIS ARCHIVE ALREADY HAS.
       Ordered by how much each holds, because the cap bites: shown the
       busiest first, the model reuses the shelf a capture most likely
       belongs on, and a long tail of one-offs cannot crowd out the
       categories that actually organise the archive. Read from the
       keeper's own captures.

       Without this the row of tabs is useless: asked cold, a model names
       each capture with a fresh phrase, and fifty saves become fifty
       categories of one. */
    db
      .select({ category: inspirations.category, held: count() })
      .from(inspirations)
      .where(and(eq(inspirations.profileId, inspiration.profileId), isNotNull(inspirations.category)))
      .groupBy(inspirations.category)
      .orderBy(desc(count()))
      .limit(MAX_EXISTING_CATEGORIES),
  ]);

  /*
    The capture's own vector, BEFORE extraction — the reorder is the feature.
    It was always computed in this pass (layer-1 recall keeps it warm even
    when a capture yields nothing); computing it first lets this same pass
    ask the one question per-capture extraction is structurally blind to:
    which of the person's EARLIER captures sit near this one? A pattern that
    returns months later, worded differently, is invisible to a reader shown
    one capture at a time — and that is most of how people actually recur.
    Same model-call count as before; the vector was never optional.
  */
  const inspirationEmbedding = await ensureInspirationEmbedding({
    profileId: inspiration.profileId,
    inspirationId: inspiration.id,
    inputScope: "personal",
    db,
    client: embeddingClient,
    beforeCommit: deps.beforeCommit,
  });
  if (inspirationEmbedding.status === "stale_source") {
    throw new Error("Source material changed during embedding");
  }
  if (inspirationEmbedding.status === "missing_inspiration") return emptyResult("missing_inspiration");
  const relatedInspirations = inspirationEmbedding.embedding
    ? await findRelatedInspirations(db, {
        /* recurrence is retrieved over the keeper's earlier captures */
        profileId: inspiration.profileId,
        inspirationId: inspiration.id,
        embedding: inspirationEmbedding.embedding.embedding,
        model: inspirationEmbedding.embedding.model,
      })
    : [];

  const extraction = await provider.extractSignalCandidates({
    profileId,
    // Statements come back in the owner's language; the locale is the hint
    // that keeps a Korean archive from being distilled into English.
    preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
    inspiration: {
      id: inspiration.id,
      text: inspiration.text,
      source: inspiration.source,
      createdAt: inspiration.createdAt,
    },
    reflections: reflectionRows.map((row) => ({
      question: row.question,
      answer: row.answer ?? "",
    })),
    attachments: attachmentRows.flatMap((row) =>
      row.text && row.kind
        ? [{ kind: row.kind, label: row.hostname ?? row.name, text: row.text }]
        : [],
    ),
    existingStatements,
    existingCategories: existingCategories.flatMap((row) => (row.category ? [row.category] : [])),
    relatedInspirations,
  });

  /*
    THE QUOTE IS CHECKED BEFORE IT IS KEPT.

    `quote` is the model naming the span it read. Downstream it is stored on
    the evidence row and the world renders it as a lit span of the person's
    own memory — and where it is NOT found in that memory the renderer falls
    back to printing the quote by itself, still inside the memory's card.
    So an invented quote does not degrade into a worse citation, it becomes
    words the product attributes to someone who never wrote them.

    `verifyQuote` is the judge for exactly this and has been written, correct
    and documented since 2026-08-01 with no caller. This is the call site it
    was missing. Models paraphrase; the refusal is the feature.

    The rule itself — own words only, and clip after verifying rather than
    before — lives in `quoteForEvidence` beside the judge, where a test can
    run it. See `salience.ts`; both orderings are wrong in the direction of
    attributing invented text to a person, which is why neither is inline.
  */
  const statements = extraction.statements
    .map((candidate) => ({
      statement: clip(candidate.statement, MAX_STATEMENT_LENGTH),
      reason: candidate.reason ? clip(candidate.reason, MAX_REASON_LENGTH) : null,
      ...resolveMaterialQuote(candidate.quote, material, MAX_QUOTE_LENGTH),
      relatedEvidence: resolveRelatedEvidence(candidate, relatedInspirations, MAX_QUOTE_LENGTH).map((row) => {
        const source = relatedInspirations.find((offered) => offered.id === row.inspirationId)!;
        const identity = relatedMaterialIdentity(source, material.identity.scope);
        return { ...row, material: identity, quoteSourceHash: identity.sources[0]!.hash };
      }),
    }))
    .filter((candidate) => candidate.statement.length > 0);

  const validateSources = async (tx: WakaTx) => {
    await assertMaterialCurrent(tx, material, relatedInspirations);
    await deps.beforeCommit?.(tx);
  };
  const canComplete = !supportReview?.retryable && !material.attachmentRows.some((row) => row.status !== "ready" && row.status !== "unavailable");

  if (statements.length === 0) {
    await db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx, profileId); await validateSources(tx);
      if (deps.processingRequest) await finishInspirationDerivation(tx, processingInput(material.identity.revision), {
        complete: canComplete, requestReading: () => requestReading(tx),
      });
    });
    await wakeCommittedBackgroundJobs();
    return emptyResult("no_candidates");
  }

  const embedded: ResolvedCandidate[] = [];
  for (const candidate of statements) {
    const embedding = await embeddingClient.embed(candidate.statement);
    // One capture saying the same thing twice is one pattern.
    const duplicate = embedded.some((seen) => {
      const similarity = cosineSimilarity(seen.embedding, embedding);
      return similarity !== null && similarity >= SIGNAL_BATCH_DEDUPE_MIN_COSINE;
    });
    if (!duplicate) embedded.push({ ...candidate, embedding });
  }

  const outcome = await db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx, profileId);
      /**
       * THE SHELF THE CAPTURE GOES ON.
       *
       * Only ever written when the reading named one. A pass that returns
       * null leaves whatever was there — a capture that was placed once and
       * re-read later during a model wobble should not quietly lose its
       * shelf, and "could not place it this time" is not the same fact as
       * "it belongs nowhere".
       */
      if (extraction.category) {
        await tx
          .update(inspirations)
          .set({ category: extraction.category })
          .where(eq(inspirations.id, inspiration.id));
      }
      const applied = await applyCandidates(tx, {
        profileId,
        evidenceOwnerProfileId: inspiration.profileId,
        inspirationId: inspiration.id,
        candidates: embedded,
        embeddingModel: embeddingClient.model,
        provider,
        preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
        now,
        material: material.identity,
        beforeWrites: () => validateSources(tx),
      });
      let reading: Awaited<ReturnType<typeof requestReading>> | undefined;
      const changed = applied.matchedSignalIds.length > 0 ||
        applied.mintedSignalIds.length > 0 || applied.promotedSignalIds.length > 0;
      if (changed) reading = await requestReading(tx);
      if (deps.processingRequest) await finishInspirationDerivation(tx, processingInput(material.identity.revision), {
        reading, complete: canComplete, requestReading: () => requestReading(tx),
      });
      return applied;
    });

  await wakeCommittedBackgroundJobs();
  return {
    status: "derived",
    inspirationId: inspiration.id,
    profileId,
    candidateCount: embedded.length,
    supportReview,
    ...outcome,
  };
}

/**
 * The current capture's nearest earlier captures, by stored inspiration
 * vectors — the recurrence the extractor is allowed to see. In-memory cosine
 * over the same bounded scan match-or-mint uses; no model call, the vectors
 * already exist. Ordered strongest first, floored, and capped to context
 * size, so the current capture stays the loudest thing in the prompt.
 */
async function findRelatedInspirations(
  db: WakaDb,
  input: {
    profileId: string;
    inspirationId: string;
    embedding: number[];
    model: string;
  },
): Promise<RelatedInspirationContext[]> {
  const rows = await db
    .select({
      id: inspirations.id,
      text: inspirations.text,
      createdAt: inspirations.createdAt,
      embedding: inspirationEmbeddings.embedding,
    })
    .from(inspirationEmbeddings)
    .innerJoin(inspirations, eq(inspirations.id, inspirationEmbeddings.inspirationId))
    .where(
      and(
        eq(inspirationEmbeddings.profileId, input.profileId),
        eq(inspirationEmbeddings.model, input.model),
        eq(inspirationEmbeddings.inputScope, "personal"),
      ),
    )
    .orderBy(desc(inspirations.createdAt))
    .limit(RELATED_INSPIRATION_SCAN_LIMIT);

  return rows
    .filter((row) => row.id !== input.inspirationId)
    .map((row) => ({
      row,
      similarity: cosineSimilarity(input.embedding, row.embedding) ?? -1,
    }))
    .filter((scored) => scored.similarity >= RELATED_INSPIRATION_MIN_COSINE)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RELATED_INSPIRATION_CONTEXT_LIMIT)
    .map(({ row }) => ({ id: row.id, text: row.text, createdAt: row.createdAt }));
}

/**
 * Which of a candidate's related-capture citations survive code's checks.
 * Pure, so the two rules are testable without a database:
 *
 *   - the cited id must be one that was actually OFFERED — the model cannot
 *     conjure evidence from a capture it was never shown;
 *   - the quote must genuinely appear in THAT capture's own text (same
 *     verbatim rule as the primary quote, via `quoteForEvidence`), and a
 *     citation whose quote fails is dropped whole. The quote is not
 *     decoration here: it is the only thing standing between "these two
 *     captures share a theme" and "this capture is evidence of this
 *     pattern", and the model asserting the second must prove it in the
 *     capture's own words.
 */
export function resolveRelatedEvidence(
  candidate: Pick<SignalCandidate, "relatedEvidence">,
  offered: RelatedInspirationContext[],
  maxQuoteLength: number,
): Array<{ inspirationId: string; quote: string }> {
  if (!candidate.relatedEvidence?.length || offered.length === 0) return [];
  const offeredById = new Map(offered.map((row) => [row.id, row]));

  return candidate.relatedEvidence.flatMap((cited) => {
    const witness = offeredById.get(cited.inspirationId);
    if (!witness) return [];
    const quote = quoteForEvidence(
      cited.quote,
      { text: witness.text, enrichment: null },
      maxQuoteLength,
    );
    return quote ? [{ inspirationId: witness.id, quote }] : [];
  });
}

/** Exposed for callers that summarize a pass without re-reading the rows. */
export function describeSignalDerivation(result: SignalDerivationResult): string {
  return [
    `status=${result.status}`,
    `candidates=${result.candidateCount}`,
    `matched=${result.matchedSignalIds.length}`,
    `minted=${result.mintedSignalIds.length}`,
    `promoted=${result.promotedSignalIds.length}`,
  ].join(" ");
}
