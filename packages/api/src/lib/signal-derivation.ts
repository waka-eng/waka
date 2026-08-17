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
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  attachments,
  inspirations,
  profiles,
  reflections,
  signalEmbeddings,
  signalEvidence,
  signals,
  type SignalStatus,
} from "../db/index.js";
import { cosineSimilarity } from "../scoring/vector.js";
import { getDb } from "./db.js";
import {
  ensureInspirationEmbedding,
  GeminiEmbeddingHttpClient,
  hashEmbeddingInput,
} from "./inspiration-embeddings.js";
import { normalizeSupportedLocale } from "./locales.js";
import { getDefaultModelProvider, type ModelProvider } from "./model-provider.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

/** Whatever can produce a vector for a statement, so tests need no network. */
export interface StatementEmbeddingClient {
  readonly model: string;
  embed(input: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Tuning constants
//
// Every number below is a first, defensible guess made without a corpus.
// Phase 4 tunes them against real archives; they live here as named exports
// precisely so that tuning is a one-file diff and a reviewer can see what
// moved. A magic number buried in a comparison is a number nobody ever tunes.
// ---------------------------------------------------------------------------

/**
 * Above this cosine, a candidate is the pattern an existing signal already
 * names, and the capture becomes evidence for it. Deliberately high: a false
 * match quietly fuses two distinct patterns into one and there is no surface
 * anywhere that would show it happened, while a false mint shows up as a
 * near-duplicate the owner can merge.
 */
export const SIGNAL_MATCH_MIN_COSINE = 0.86;

/**
 * Between this and the match bar, distance alone cannot decide: statements
 * this close are sometimes one pattern reworded and sometimes two patterns
 * sharing a vocabulary. The band gets one judge call for the single nearest
 * candidate. Below it, minting needs no permission — and above the match bar,
 * attaching needs none.
 */
export const SIGNAL_MERGE_JUDGE_MIN_COSINE = 0.7;

/** What match-or-mint does with a similarity, before any model is consulted. */
export function classifyMatch(similarity: number | null): "attach" | "judge" | "mint" {
  if (similarity === null) return "mint";
  if (similarity >= SIGNAL_MATCH_MIN_COSINE) return "attach";
  if (similarity >= SIGNAL_MERGE_JUDGE_MIN_COSINE) return "judge";
  return "mint";
}

/**
 * Two candidates from the *same* capture this close are one pattern said
 * twice. Higher than the match bar because both came from one model call on
 * one input, so genuine distinctness needs more separation to be believable.
 */
export const SIGNAL_BATCH_DEDUPE_MIN_COSINE = 0.94;

/** Evidence count at which an `emerging` signal becomes `active`. */
export const SIGNAL_PROMOTION_MIN_EVIDENCE = 3;

/** Evidence count at which the support term of confidence saturates. */
export const CONFIDENCE_SATURATION_EVIDENCE = 6;

/**
 * Days between first and last evidence at which the durability term
 * saturates. A pattern that recurs across a month is a pattern; five captures
 * in one afternoon are one afternoon.
 */
export const CONFIDENCE_SATURATION_SPREAD_DAYS = 30;

/** Half-life of the recency term: how fast a quiet signal reads as quiet. */
export const CONFIDENCE_RECENCY_HALF_LIFE_DAYS = 45;

/** Weights of the three confidence terms; they sum to 100. */
export const CONFIDENCE_SUPPORT_WEIGHT = 55;
export const CONFIDENCE_SPREAD_WEIGHT = 30;
export const CONFIDENCE_RECENCY_WEIGHT = 15;

/**
 * Ceiling on how many of a profile's signals are scanned for a match. The
 * comparison is in application memory over jsonb vectors, so this bounds the
 * work per capture; ordering by recency of evidence means the signals most
 * likely to match are the ones that survive the cut.
 */
export const MATCH_CANDIDATE_SCAN_LIMIT = 500;

const MAX_STATEMENT_LENGTH = 500;
const MAX_QUOTE_LENGTH = 500;
const MAX_REASON_LENGTH = 500;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Bonus when a pattern is corroborated by more than one kind of capturer —
 * the person's own saves and an agent's observations agreeing is evidence
 * neither could supply alone.
 *
 * A bonus rather than a weighted term, deliberately: most profiles are
 * app-only, and a weight would cap every solo human below 100 forever.
 * Corroboration adds; its absence must not subtract.
 */
export const CONFIDENCE_SOURCE_DIVERSITY_BONUS = 8;

export interface ConfidenceEvidence {
  createdAt: Date;
  source: "app" | "agent";
}

/**
 * Confidence from evidence alone: how much of it there is, how far it spreads
 * in time, how recently it last arrived, and whether more than one kind of
 * capturer supplied it. No model input — a number the owner can be told the
 * derivation of.
 */
export function computeSignalConfidence(evidence: ConfidenceEvidence[], now: Date): number {
  if (evidence.length === 0) return 0;

  const evidenceAt = evidence.map((row) => row.createdAt);
  const distinctSources = new Set(evidence.map((row) => row.source)).size;
  const times = evidenceAt.map((date) => date.getTime()).sort((a, b) => a - b);
  const first = times[0]!;
  const last = times[times.length - 1]!;

  const support = Math.min(1, times.length / CONFIDENCE_SATURATION_EVIDENCE);
  const spreadDays = (last - first) / MS_PER_DAY;
  const spread = Math.min(1, spreadDays / CONFIDENCE_SATURATION_SPREAD_DAYS);
  const quietDays = Math.max(0, (now.getTime() - last) / MS_PER_DAY);
  const recency = Math.pow(2, -quietDays / CONFIDENCE_RECENCY_HALF_LIFE_DAYS);

  const score =
    CONFIDENCE_SUPPORT_WEIGHT * support +
    CONFIDENCE_SPREAD_WEIGHT * spread +
    CONFIDENCE_RECENCY_WEIGHT * recency +
    (distinctSources > 1 ? CONFIDENCE_SOURCE_DIVERSITY_BONUS : 0);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/**
 * Serializes match-or-mint for one profile. Two captures processed at the
 * same moment would otherwise each find no match and each mint the same new
 * signal, and nothing downstream would ever merge them.
 */
export async function acquireSignalDerivationLock(
  tx: WakaTx,
  profileId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${["waka.signal_derivation", profileId].join("\n")}, 0))`,
  );
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface DeriveSignalsInput {
  inspirationId: string;
  /** "created" on capture, "edited" when a change re-derives the capture. */
  reason: "created" | "edited";
}

export interface SignalDerivationDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  embeddingClient?: StatementEmbeddingClient;
  now?: Date;
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
}

interface MatchTarget {
  id: string;
  statement: string;
  status: SignalStatus;
  locked: boolean;
  embedding: number[];
}

interface ResolvedCandidate {
  statement: string;
  reason: string | null;
  quote: string | null;
  embedding: number[];
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
  const now = deps.now ?? new Date();
  const provider = deps.modelProvider ?? (await getDefaultModelProvider());
  const embeddingClient = deps.embeddingClient ?? new GeminiEmbeddingHttpClient();

  const [inspiration] = await db
    .select()
    .from(inspirations)
    .where(eq(inspirations.id, input.inspirationId))
    .limit(1);

  if (!inspiration) {
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

  const profileId = inspiration.profileId;

  const [profileRows, reflectionRows, attachmentRows, existingStatements] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1),
    db
      .select({
        question: reflections.question,
        answer: reflections.answer,
      })
      .from(reflections)
      .where(
        and(
          eq(reflections.inspirationId, inspiration.id),
          eq(reflections.skipped, false),
          isNotNull(reflections.answer),
        ),
      ),
    db
      .select({
        kind: attachments.enrichmentKind,
        text: attachments.enrichmentText,
        hostname: attachments.hostname,
        name: attachments.name,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.inspirationId, inspiration.id),
          eq(attachments.enrichmentStatus, "ready"),
          isNotNull(attachments.enrichmentText),
        ),
      ),
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
  ]);

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
  });

  // The capture's own vector is layer-1 machinery (recall, future matching),
  // and it is worth keeping current even when this capture yielded nothing.
  await ensureInspirationEmbedding({ profileId, inspirationId: inspiration.id });

  const statements = extraction.statements
    .map((candidate) => ({
      statement: clip(candidate.statement, MAX_STATEMENT_LENGTH),
      reason: candidate.reason ? clip(candidate.reason, MAX_REASON_LENGTH) : null,
      quote: candidate.quote ? clip(candidate.quote, MAX_QUOTE_LENGTH) : null,
    }))
    .filter((candidate) => candidate.statement.length > 0);

  if (statements.length === 0) {
    return {
      status: "no_candidates",
      inspirationId: inspiration.id,
      profileId,
      candidateCount: 0,
      matchedSignalIds: [],
      mintedSignalIds: [],
      promotedSignalIds: [],
    };
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
    return applyCandidates(tx, {
      profileId,
      inspirationId: inspiration.id,
      candidates: embedded,
      embeddingModel: embeddingClient.model,
      provider,
      preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
      now,
    });
  });

  return {
    status: "derived",
    inspirationId: inspiration.id,
    profileId,
    candidateCount: embedded.length,
    ...outcome,
  };
}

// ---------------------------------------------------------------------------
// Match-or-mint
// ---------------------------------------------------------------------------

interface ApplyCandidatesInput {
  profileId: string;
  inspirationId: string;
  candidates: ResolvedCandidate[];
  embeddingModel: string;
  provider: ModelProvider;
  preferredLocale: ReturnType<typeof normalizeSupportedLocale>;
  now: Date;
}

async function applyCandidates(
  tx: WakaTx,
  input: ApplyCandidatesInput,
): Promise<Pick<SignalDerivationResult, "matchedSignalIds" | "mintedSignalIds" | "promotedSignalIds">> {
  const targets = await loadMatchTargets(tx, input.profileId, input.embeddingModel);

  const matchedSignalIds: string[] = [];
  const mintedSignalIds: string[] = [];
  const touched = new Set<string>();

  for (const candidate of input.candidates) {
    const nearest = findBestMatch(candidate.embedding, targets);
    let decision = classifyMatch(nearest?.similarity ?? null);

    if (decision === "judge" && nearest) {
      // One bounded model call, held under the per-profile derivation lock.
      // Serializing a ~second of judgement is the price of the lock's whole
      // point: two concurrent captures must not each mint the same pattern.
      // A judge failure falls through to minting — the duplicate is the
      // recoverable mistake, and the fallthrough is the same verdict the
      // judge itself returns when uncertain.
      try {
        const judged = await input.provider.judgeSignalMatch({
          preferredLocale: input.preferredLocale,
          candidateStatement: candidate.statement,
          existingStatement: nearest.target.statement,
        });
        decision = judged.samePattern ? "attach" : "mint";
      } catch {
        decision = "mint";
      }
    }

    const match = decision === "attach" ? nearest : null;

    if (match) {
      await attachEvidence(tx, {
        profileId: input.profileId,
        signalId: match.target.id,
        inspirationId: input.inspirationId,
        reason: candidate.reason,
        quote: candidate.quote,
      });

      // An emerging signal is a first draft read from a single capture; the
      // capture that confirms it usually names the pattern better. Once a
      // signal is active its wording has settled, and only its owner moves it.
      if (!match.target.locked && match.target.status === "emerging") {
        const restated = await restateSignal(tx, match.target, candidate.statement);
        if (restated) {
          await writeSignalEmbedding(tx, {
            profileId: input.profileId,
            signalId: match.target.id,
            statement: candidate.statement,
            embedding: candidate.embedding,
            model: input.embeddingModel,
          });
          match.target.statement = candidate.statement;
          match.target.embedding = candidate.embedding;
        }
      }

      matchedSignalIds.push(match.target.id);
      touched.add(match.target.id);
      continue;
    }

    const [minted] = await tx
      .insert(signals)
      .values({
        profileId: input.profileId,
        statement: candidate.statement,
        status: "emerging",
        confidence: 0,
      })
      .returning({ id: signals.id });
    if (!minted) throw new Error("Failed to mint signal");

    // The vector that decided this candidate had no match is, by definition,
    // the vector of the statement just minted. Re-embedding it would be a
    // second network round-trip to compute a number already in hand.
    await writeSignalEmbedding(tx, {
      profileId: input.profileId,
      signalId: minted.id,
      statement: candidate.statement,
      embedding: candidate.embedding,
      model: input.embeddingModel,
    });

    await attachEvidence(tx, {
      profileId: input.profileId,
      signalId: minted.id,
      inspirationId: input.inspirationId,
      reason: candidate.reason,
      quote: candidate.quote,
    });

    mintedSignalIds.push(minted.id);
    touched.add(minted.id);

    // Visible to the rest of this batch: two candidates that both fail to
    // match anything existing must not both mint when the second one is
    // simply the first one again.
    targets.push({
      id: minted.id,
      statement: candidate.statement,
      status: "emerging",
      locked: false,
      embedding: candidate.embedding,
    });
  }

  const promotedSignalIds: string[] = [];
  for (const signalId of touched) {
    const promoted = await refreshSignalLifecycle(tx, signalId, input.now);
    if (promoted) promotedSignalIds.push(signalId);
  }

  return { matchedSignalIds, mintedSignalIds, promotedSignalIds };
}

async function loadMatchTargets(
  tx: WakaTx,
  profileId: string,
  embeddingModel: string,
): Promise<MatchTarget[]> {
  const rows = await tx
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
      lockedAt: signals.lockedAt,
      embedding: signalEmbeddings.embedding,
    })
    .from(signals)
    .innerJoin(signalEmbeddings, eq(signalEmbeddings.signalId, signals.id))
    .where(
      and(
        eq(signals.profileId, profileId),
        // A retired signal is either evidence-dead or hidden by its owner.
        // Reviving one because a new capture resembles it would undo a human
        // decision without asking, so retired rows are simply not candidates.
        inArray(signals.status, ["emerging", "active"]),
        eq(signalEmbeddings.model, embeddingModel),
      ),
    )
    .orderBy(desc(signals.lastEvidenceAt))
    .limit(MATCH_CANDIDATE_SCAN_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    statement: row.statement,
    status: row.status,
    locked: row.lockedAt !== null,
    embedding: row.embedding,
  }));
}

function findBestMatch(
  embedding: number[],
  targets: MatchTarget[],
): { target: MatchTarget; similarity: number } | null {
  let best: { target: MatchTarget; similarity: number } | null = null;

  for (const target of targets) {
    const similarity = cosineSimilarity(embedding, target.embedding);
    if (similarity === null || similarity < SIGNAL_MERGE_JUDGE_MIN_COSINE) continue;
    if (!best || similarity > best.similarity) best = { target, similarity };
  }

  return best;
}

async function attachEvidence(
  tx: WakaTx,
  input: {
    profileId: string;
    signalId: string;
    inspirationId: string;
    reason: string | null;
    quote: string | null;
  },
): Promise<void> {
  // Re-derivation after an edit revisits captures this signal already cites.
  // The unique index is what keeps a re-run from inflating support; taking
  // the conflict as a no-op keeps the first reason and quote, which were
  // written when the capture was closer to its original form.
  await tx
    .insert(signalEvidence)
    .values({
      profileId: input.profileId,
      signalId: input.signalId,
      inspirationId: input.inspirationId,
      reason: input.reason,
      quote: input.quote,
    })
    .onConflictDoNothing();
}

/**
 * The only path that writes `signals.statement`. The lock check is here, at
 * the write, rather than only at the call site: a caller can forget, and this
 * is the guarantee the whole edit rule rests on. The `lockedAt is null`
 * predicate on the UPDATE is the same check again, in the one place a race
 * cannot slip past it.
 */
async function restateSignal(
  tx: WakaTx,
  target: MatchTarget,
  statement: string,
): Promise<boolean> {
  if (target.locked) return false;
  if (statement === target.statement) return false;

  const updated = await tx
    .update(signals)
    .set({ statement, updatedAt: new Date() })
    .where(and(eq(signals.id, target.id), isNull(signals.lockedAt)))
    .returning({ id: signals.id });

  return updated.length > 0;
}

/**
 * A signal's vector is its statement's vector. Keyed by (signal, model) so a
 * restatement replaces the old vector rather than leaving match-or-mint
 * comparing against text the signal no longer says.
 */
async function writeSignalEmbedding(
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
 * Recompute everything derived from evidence: confidence, the denormalized
 * recency, promotion, and whether a locked signal is supported again.
 * Returns true when this pass promoted the signal to `active`.
 */
async function refreshSignalLifecycle(
  tx: WakaTx,
  signalId: string,
  now: Date,
): Promise<boolean> {
  const [current] = await tx
    .select()
    .from(signals)
    .where(eq(signals.id, signalId))
    .limit(1);
  if (!current) return false;

  const evidenceRows = await tx
    .select({ createdAt: signalEvidence.createdAt, source: inspirations.source })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(eq(signalEvidence.signalId, signalId));

  const evidenceAt = evidenceRows.map((row) => row.createdAt);
  const confidence = computeSignalConfidence(evidenceRows, now);
  const lastEvidenceAt = evidenceAt.reduce<Date | null>(
    (latest, date) => (latest === null || date > latest ? date : latest),
    null,
  );

  const promote =
    current.status === "emerging" && evidenceAt.length >= SIGNAL_PROMOTION_MIN_EVIDENCE;
  const status: SignalStatus = promote ? "active" : current.status;

  await tx
    .update(signals)
    .set({
      status,
      confidence,
      lastEvidenceAt,
      // Support returned. A locked signal keeps its text either way; what
      // changes is that readers stop being told it stands on nothing.
      unsupportedAt: evidenceAt.length > 0 ? null : current.unsupportedAt,
      updatedAt: now,
    })
    .where(eq(signals.id, signalId));

  return promote;
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

/**
 * Settle signals whose citations have just been deleted.
 *
 * Evidence rows vanish by foreign-key cascade when an inspiration is deleted,
 * which leaves a signal standing on nothing while still claiming to be
 * active. Deletion is the one path where support disappears without any
 * derivation pass running, so the reconciliation has to be driven from the
 * delete itself.
 *
 * What happens to a stranded signal depends on whose words it is. A generated
 * statement is retired: nothing supports it and nobody chose it. A locked one
 * is the owner's own sentence, so it stays and is marked unsupported instead —
 * deleting a person's writing because its footnotes went would be WAKA
 * editing them.
 *
 * Callers pass the signal ids collected *before* the delete, since afterwards
 * there is nothing left to join through.
 */
export async function reconcileSignalsAfterEvidenceLoss(
  db: WakaDb | WakaTx,
  input: { profileId: string; signalIds: string[] },
): Promise<{ retired: string[]; unsupported: string[] }> {
  const retired: string[] = [];
  const unsupported: string[] = [];
  if (input.signalIds.length === 0) return { retired, unsupported };

  const now = new Date();

  for (const signalId of input.signalIds) {
    const [signal] = await db
      .select({
        id: signals.id,
        status: signals.status,
        lockedAt: signals.lockedAt,
      })
      .from(signals)
      .where(and(eq(signals.id, signalId), eq(signals.profileId, input.profileId)))
      .limit(1);
    if (!signal || signal.status === "retired") continue;

    const remaining = await db
      .select({ createdAt: signalEvidence.createdAt, source: inspirations.source })
      .from(signalEvidence)
      .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
      .where(eq(signalEvidence.signalId, signalId));

    if (remaining.length > 0) {
      // Still supported, just by less. Confidence and recency move with it.
      const evidenceAt = remaining.map((row) => row.createdAt);
      await db
        .update(signals)
        .set({
          confidence: computeSignalConfidence(remaining, now),
          lastEvidenceAt: evidenceAt.reduce<Date | null>(
            (latest, date) => (latest === null || date > latest ? date : latest),
            null,
          ),
          unsupportedAt: null,
          updatedAt: now,
        })
        .where(eq(signals.id, signalId));
      continue;
    }

    if (signal.lockedAt) {
      await db
        .update(signals)
        .set({ unsupportedAt: now, confidence: 0, lastEvidenceAt: null, updatedAt: now })
        .where(eq(signals.id, signalId));
      unsupported.push(signalId);
    } else {
      // Retirement already says everything: `unsupported_at` is reserved for
      // the locked survivor, where "your words stand, nothing supports them"
      // is a distinct fact a reader needs. Setting it here too would make an
      // ordinary retired row read as that special case.
      await db
        .update(signals)
        .set({
          status: "retired",
          confidence: 0,
          lastEvidenceAt: null,
          unsupportedAt: null,
          updatedAt: now,
        })
        .where(eq(signals.id, signalId));
      retired.push(signalId);
    }
  }

  return { retired, unsupported };
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
