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

import { and, desc, eq, inArray } from "drizzle-orm";

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
import {
  assertGroupInputCurrent,
  loadGroupInputMembership,
  GROUP_INPUT_POLICY,
  GroupInputUnavailableError,
} from "./group-inputs.js";
import { assertMaterialCurrent, loadInspirationMaterial, relatedMaterialIdentity, resolveMaterialQuote } from "./inspiration-material.js";
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
  /**
   * WHERE THE SIGNALS LAND (2026-08-24). Absent, on the inspiration's own
   * profile — every personal pass, unchanged. Set, on a ROOM'S MIND: the
   * same extraction over the same capture, but matched against the ROOM's
   * existing statements, minted under the room's profile, and cited with
   * the keeper as the evidence owner. One capture, several passes, several
   * spaces — which is the founder's x+y+z, made literal.
   */
  deriveIntoProfileId?: string;
}

export interface SignalDerivationDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  embeddingClient?: StatementEmbeddingClient;
  now?: Date;
}

export interface SignalDerivationResult {
  status: "derived" | "missing_inspiration" | "no_candidates" | "not_public" | "not_authorized";
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
     owner for a personal pass, a room's mind for a room pass. Everything
     downstream of extraction keys off it: the existing-statement scan, the
     match targets, the advisory lock, the mint. The one deliberate
     exception is the capture's own layer-1 embedding, which stays with the
     memory's owner wherever the pass is landing. */
  const profileId = input.deriveIntoProfileId ?? inspirationRow.profileId;
  const isGroup = input.deriveIntoProfileId !== undefined;
  const emptyResult = (status: SignalDerivationResult["status"]): SignalDerivationResult => ({
    status, inspirationId: inspirationRow.id, profileId, candidateCount: 0,
    matchedSignalIds: [], mintedSignalIds: [], promotedSignalIds: [],
  });
  const membership = isGroup ? await loadGroupInputMembership(db, inspirationRow.profileId, profileId) : null;
  if (isGroup && !membership) return emptyResult("not_authorized");

  /**
   * A ROOM PASS RE-READS THE SWITCH IT WAS ENQUEUED ON.
   *
   * The fan-out reads `visibility` when it enqueues, and then the job waits
   * in a queue — behind a backlog, a deferral, a retry. In that gap the
   * keeper can turn the memory private, and without this check the room
   * would read it anyway: the enqueue-time check would have been a promise
   * about a value that had already changed. A memory going private is the
   * one thing that must be true at the moment of reading, not at the moment
   * of asking, so it is read here, against the row the pass is about to use.
   *
   * Personal passes are untouched: your own memory is yours to distil at any
   * visibility, and `deriveIntoProfileId` is exactly the flag for "this pass
   * is landing somewhere other than the keeper's own stack".
   */
  if (input.deriveIntoProfileId && inspirationRow.visibility !== "public") {
    return {
      status: "not_public",
      inspirationId: input.inspirationId,
      profileId,
      candidateCount: 0,
      matchedSignalIds: [],
      mintedSignalIds: [],
      promotedSignalIds: [],
    };
  }

  const material = await loadInspirationMaterial(db, inspirationRow.profileId, inspirationRow.id, isGroup ? "public" : "personal");
  if (!material) return emptyResult("missing_inspiration");
  const inspiration = material.inspiration;
  if (isGroup && inspiration.visibility !== "public") return emptyResult("not_public");
  const reflectionRows = material.reflectionRows;
  const attachmentRows = material.attachmentRows.filter((row) => row.status === "ready" && row.text !== null)
    .map(({ id, kind, text, hostname, name }) => ({ id, kind, text, hostname, name }));
  const [profileRows, existingStatements] = await Promise.all([
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
          ...(isGroup ? [eq(signals.inputPolicy, GROUP_INPUT_POLICY)] : []),
          inArray(signals.status, ["emerging", "active"]),
        ),
      )
      .orderBy(desc(signals.lastEvidenceAt))
      .limit(MATCH_CANDIDATE_SCAN_LIMIT),
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
    /* Both scope-specific vectors belong to the memory's OWNER. A room
       never reuses a personal vector, which can encode private answers. */
    profileId: inspiration.profileId,
    inspirationId: inspiration.id,
    inputScope: isGroup ? "public" : "personal",
    db,
    client: embeddingClient,
  });
  if (inspirationEmbedding.status === "stale_source") {
    throw new Error("Source material changed during embedding");
  }
  if (isGroup && inspirationEmbedding.status === "not_public") return emptyResult("not_public");
  if (inspirationEmbedding.status === "missing_inspiration") return emptyResult("missing_inspiration");
  const relatedInspirations = inspirationEmbedding.embedding
    ? await findRelatedInspirations(db, {
        /* recurrence is retrieved over the KEEPER's earlier captures on every
           pass — on a room pass the mind holds no captures to scan, and the
           person recurring is the person, wherever the pattern lands */
        profileId: inspiration.profileId,
        inspirationId: inspiration.id,
        embedding: inspirationEmbedding.embedding.embedding,
        model: inspirationEmbedding.embedding.model,
        /* a room may cite only what its members chose to make public: a
           private earlier capture must never become a room's evidence */
        publicOnly: input.deriveIntoProfileId !== undefined,
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
    if (isGroup && membership) await assertGroupInputCurrent(tx, {
      mindProfileId: profileId, membershipId: membership.id, inspiration,
      attachments: attachmentRows, related: relatedInspirations,
    });
    await assertMaterialCurrent(tx, material, relatedInspirations);
  };

  if (statements.length === 0) {
    try {
      await db.transaction(async (tx) => { await acquireSignalDerivationLock(tx, profileId); await validateSources(tx); });
      return emptyResult("no_candidates");
    } catch (error) {
      if (error instanceof GroupInputUnavailableError) return emptyResult(error.status);
      throw error;
    }
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

  let outcome;
  try {
    outcome = await db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx, profileId);
      const applied = await applyCandidates(tx, {
        profileId,
        inputPolicy: isGroup ? GROUP_INPUT_POLICY : undefined,
        /* A room's evidence still belongs to the capture's owner. */
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
      return applied;
    });
  } catch (error) {
    if (error instanceof GroupInputUnavailableError) return emptyResult(error.status);
    throw error;
  }

  return {
    status: "derived",
    inspirationId: inspiration.id,
    profileId,
    candidateCount: embedded.length,
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
    /** a ROOM pass may only be shown captures their owner made public */
    publicOnly?: boolean;
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
        eq(inspirationEmbeddings.inputScope, input.publicOnly ? "public" : "personal"),
        ...(input.publicOnly ? [eq(inspirations.visibility, "public" as const)] : []),
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
