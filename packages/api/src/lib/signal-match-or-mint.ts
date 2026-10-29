/**
 * Match-or-mint: deciding whether a candidate statement is a pattern the
 * profile already holds, or a new one.
 *
 * Cosine distance finds the nearest eligible signal. Above the attach bar,
 * identical wording may attach directly; changed wording still needs a
 * meaning check. Below the judge floor it mints without a relation call.
 *
 * Each candidate spends at most one match judgment on its single nearest
 * target. Changed or negated positions can have almost identical vectors;
 * time scope and certainty are part of their meaning. Review answers always
 * check nearby matches, even when wording is identical.
 * A failure propagates
 * for retry rather than inventing an independent pattern. All judgments are
 * prepared before source locks and evidence writes.
 *
 * The lock rule is enforced downstream of the match: a signal whose `lockedAt`
 * is set never has its statement rewritten here, no matter how the candidate
 * that matched it is worded. See `restateSignal`.
 *
 * Dismissed wording is checked first. Exact wording is refused directly;
 * otherwise similarity retrieves one nearby anchor and a semantic `same`
 * verdict is required. Opposite views and different time scopes proceed to
 * ordinary discovery. Refusals are recorded without reviving their anchor.
 */

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import {
  inspirations,
  signalEmbeddings,
  signalEvidence,
  signalSupportReviews,
  signals,
  suppressions,
  type SignalStatus,
} from "../db/index.js";
import { cosineSimilarity } from "../scoring/vector.js";
import { hashEmbeddingInput } from './inspiration-embeddings.js';
import { getDb } from "./db.js";
import type { normalizeSupportedLocale } from "./locales.js";
import type { ModelProvider } from "./model-provider.js";
// The pass owns the shape of its own result; this stage fills three of its
// fields. Importing the type back from the facade is a type-only edge — it is
// erased before runtime, so the module graph still points one way. The
// alternative, a types-only module sitting under both, was rejected: it would
// own no stage, and every reader would have to open it to learn nothing.
import type { SignalDerivationResult } from "./signal-derivation.js";
import {
  classifyMatch,
  MATCH_CANDIDATE_SCAN_LIMIT,
  SIGNAL_MERGE_JUDGE_MIN_COSINE,
  SIGNAL_SUPPRESSION_MIN_COSINE,
} from "./signal-derivation-thresholds.js";
import { recordContradiction } from "./contested-pairs.js";
import { writeSignalEmbedding } from "./signal-embeddings.js";
import { refreshSignalLifecycle } from "./signal-lifecycle.js";
import { writeSignalStatementChain } from "./statement-chains.js";
import type { InspirationMaterialIdentity } from "./inspiration-material.js";
import { readInspirationRevision } from './inspiration-processing.js';
import { requestRemainingSignalSupportReviews } from './signal-statement-work.js';

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

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

interface MatchTarget {
  id: string;
  statement: string;
  status: SignalStatus;
  locked: boolean;
  withdrawn: boolean;
  embedding: number[];
}

export interface ResolvedCandidate {
  statement: string;
  reason: string | null;
  quote: string | null;
  /** Whose words the verified quote is; null when quote is null. */
  quoteSource: "own" | "enrichment" | null;
  quoteReflectionId?: string | null;
  quoteSourceHash?: string | null;
  embedding: number[];
  /**
   * Earlier captures of the same profile that co-witness this pattern —
   * already validated upstream (`resolveRelatedEvidence`): each id was one
   * the extractor was actually shown, and each quote is a verified verbatim
   * span of that capture's own text. Attached as ordinary evidence rows for
   * whatever signal this candidate lands on, dated by their own capture
   * dates via the lifecycle read.
   */
  relatedEvidence: Array<{ inspirationId: string; quote: string; material?: InspirationMaterialIdentity; quoteSourceHash?: string }>;
}

interface ApplyCandidatesInput {
  profileId: string;
  /** Room context, targets and new signals must share the verified policy. */
  inputPolicy?: string;
  inspirationId: string|null;
  /** A review is not a synthetic inspiration. Its caller owns validated
   * support writes, and meaning is checked even above the cosine attach bar. */
  reviewSource?:{answerId:string;withdrawnSignalIds:Set<string>;attach:(tx:WakaTx,signalId:string)=>Promise<void>};
  /**
   * WHOSE MEMORY THE EVIDENCE CITES — the inspiration's owner. Equal to
   * `profileId` for every personal derivation; different exactly when a
   * ROOM distils (2026-08-24): `profileId` is then the room's mind and this
   * is the member whose public memory is being read. The evidence rows carry
   * it, and the inspiration foreign key runs through it, so a wrong value is
   * refused by Postgres rather than stored.
   */
  evidenceOwnerProfileId: string;
  candidates: ResolvedCandidate[];
  embeddingModel: string;
  provider: ModelProvider;
  preferredLocale: ReturnType<typeof normalizeSupportedLocale>;
  now: Date;
  material?: InspirationMaterialIdentity;
  /** Complete source/permission validation after model calls, before writes. */
  beforeWrites: () => Promise<void>;
}

/** Plan every model decision before touching evidence. Virtual targets mirror
 * same-batch mint/restatement, so the write pass needs no network under source locks. */
async function prepareJudgements(input: ApplyCandidatesInput, targets: MatchTarget[], anchors: SuppressionAnchor[]) {
  const projected = targets.map((row) => ({ ...row }));
  const judgements = new Map<number, { statement: string; relation: "same" | "independent" | "opposed" }>();
  const refusals = new Map<number, NonNullable<ReturnType<typeof findSuppressionAnchor>>>();
  for (const [index, candidate] of input.candidates.entries()) {
    const anchor = findSuppressionAnchor(candidate, anchors);
    if (anchor && (candidate.statement.trim() === anchor.anchor.statement.trim() ||
      (await input.provider.judgeSignalMatch({ preferredLocale: input.preferredLocale,
        candidateStatement: candidate.statement, existingStatement: anchor.anchor.statement })).relation === 'same')) {
      refusals.set(index, anchor);
      continue;
    }
    const nearest = findBestMatch(candidate.embedding, projected);
    if(nearest?.target.withdrawn&&nearest.target.statement.trim()===candidate.statement.trim())continue;
    let decision = classifyMatch(nearest?.similarity ?? null);
    if (nearest && (decision === "judge" || input.reviewSource || candidate.statement.trim() !== nearest.target.statement.trim())) {
      const judged = await input.provider.judgeSignalMatch({ preferredLocale: input.preferredLocale,
        candidateStatement: candidate.statement, existingStatement: nearest.target.statement });
      judgements.set(index, { statement: nearest.target.statement, relation: judged.relation });
      decision = judged.relation === "same" ? "attach" : "mint";
    }
    if (decision === "attach" && nearest) {
      if (nearest.target.withdrawn) continue;
      if (!nearest.target.locked && nearest.target.status === "emerging") {
        nearest.target.statement = candidate.statement;
        nearest.target.embedding = candidate.embedding;
      }
    } else projected.push({ id: `candidate:${index}`, statement: candidate.statement,
      status: "emerging", locked: false, withdrawn: false, embedding: candidate.embedding });
  }
  return { judgements, refusals };
}

export async function applyCandidates(
  tx: WakaTx,
  input: ApplyCandidatesInput,
): Promise<Pick<SignalDerivationResult, "matchedSignalIds" | "mintedSignalIds" | "promotedSignalIds">> {
  if((input.inspirationId===null)!==Boolean(input.reviewSource))throw new Error('One derivation source is required');
  const targets = await loadMatchTargets(tx, input.profileId, input.embeddingModel, input.inputPolicy, input.inspirationId, input.evidenceOwnerProfileId,input.reviewSource?.withdrawnSignalIds);
  const anchors = await loadSuppressionAnchors(tx, input.profileId, input.embeddingModel, input.inputPolicy);
  const prior = JSON.stringify({ targets, anchors });
  const { judgements, refusals } = await prepareJudgements(input, targets, anchors);
  await input.beforeWrites();
  const ids = [...new Set([...targets, ...anchors].map((row) => row.id))].sort();
  if (ids.length) await tx.select({ id: signals.id }).from(signals)
    .where(and(eq(signals.profileId, input.profileId), inArray(signals.id, ids)))
    .orderBy(asc(signals.id)).for("share");
  const currentTargets = await loadMatchTargets(tx, input.profileId, input.embeddingModel, input.inputPolicy, input.inspirationId, input.evidenceOwnerProfileId,input.reviewSource?.withdrawnSignalIds);
  const currentAnchors = await loadSuppressionAnchors(tx, input.profileId, input.embeddingModel, input.inputPolicy);
  if (JSON.stringify({ targets: currentTargets, anchors: currentAnchors }) !== prior) {
    throw new Error("Signal inputs changed during judgement; retry current statements");
  }

  const matchedSignalIds: string[] = [];
  const mintedSignalIds: string[] = [];
  const touched = new Set<string>();

  for (const [candidateIndex, candidate] of input.candidates.entries()) {
    // Apply only a prepared refusal after the anchor/source recheck. No
    // provider call runs under source locks; proximity alone cannot reject.
    const refused = refusals.get(candidateIndex);
    if (refused) {
      await tx.insert(suppressions).values({
        profileId: input.profileId,
        anchorSignalId: refused.anchor.id,
        anchorStatement: refused.anchor.statement,
        inspirationId: input.inspirationId,
        reviewAnswerId:input.reviewSource?.answerId??null,
        candidateStatement: candidate.statement,
        similarity: refused.similarity,
      });
      continue;
    }

    const nearest = findBestMatch(candidate.embedding, targets);
    if(nearest?.target.withdrawn&&nearest.target.statement.trim()===candidate.statement.trim())continue;
    let decision = classifyMatch(nearest?.similarity ?? null);
    /** Set when the judge answers `opposed`: the mint below also records
        the contested pair — the dispute is held, never dissolved by
        whichever statement arrived second. */
    let opposesSignalId: string | null = null;

    if (nearest && (decision === "judge" || input.reviewSource || candidate.statement.trim() !== nearest.target.statement.trim())) {
      // Reuse the pre-write verdict only for the exact planned statement.
      // No provider call runs while source rows are locked. Provider failures
      // already aborted preparation; they never become invented opposition
      // or an independent pattern here.
      const judged = judgements.get(candidateIndex);
      if (!judged || judged.statement !== nearest.target.statement) throw new Error("Signal judgement plan changed");
      decision = judged.relation === "same" ? "attach" : "mint";
      if (judged.relation === "opposed") opposesSignalId = nearest.target.id;
    }

    const match = decision === "attach" ? nearest : null;

    if (match) {
      // New discovery cannot reverse an explicit decision about this pair.
      // Keep the retired target visible to matching so it cannot mint a twin.
      if (match.target.withdrawn) continue;

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
          // The restatement joins the chain: the sentence it replaced was
          // seeded at mint (or is seeded here for pre-chain rows), so "what
          // did it say before" stays answerable — no-quiet-corners Phase 2.
          await writeSignalStatementChain(tx, {
            profileId: input.profileId,
            signalId: match.target.id,
            statement: candidate.statement,
            reason: "restated",
            seedStatement: match.target.statement,
            now: input.now,
          });
          match.target.statement = candidate.statement;
          match.target.embedding = candidate.embedding;
          await requestRemainingSignalSupportReviews(tx, { profileId: input.profileId, signalId: match.target.id,
            verifiedInspirationIds: [...(input.inspirationId?[input.inspirationId]:[]), ...candidate.relatedEvidence.map((row) => row.inspirationId)],
            verifiedReviewAnswerIds:input.reviewSource?[input.reviewSource.answerId]:[] });
        }
      }

      if(input.reviewSource)await input.reviewSource.attach(tx,match.target.id);
      else await attachEvidence(tx, {
        profileId: input.profileId, ownerProfileId: input.evidenceOwnerProfileId, signalId: match.target.id,
        inspirationId: input.inspirationId!, reason: candidate.reason, quote: candidate.quote,
        quoteSource: candidate.quoteSource, quoteReflectionId: candidate.quoteReflectionId ?? null,
        quoteSourceHash: candidate.quoteSourceHash ?? null, material: input.material ?? null,
      });
      await attachRelatedEvidence(tx, { profileId: input.profileId,
        ownerProfileId: input.evidenceOwnerProfileId, signalId: match.target.id }, candidate.relatedEvidence);

      matchedSignalIds.push(match.target.id);
      touched.add(match.target.id);
      continue;
    }

    const [minted] = await tx
      .insert(signals)
      .values({
        profileId: input.profileId,
        statement: candidate.statement,
        inputPolicy: input.inputPolicy,
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

    // The chain begins at birth: the machine's first sentence is the row
    // every later revert returns to.
    await writeSignalStatementChain(tx, {
      profileId: input.profileId,
      signalId: minted.id,
      statement: candidate.statement,
      reason: "derived",
      now: input.now,
    });

    // An opposed verdict mints AND holds the dispute: both sides now serve
    // as contested until the owner arbitrates — never the machine
    // (goals/no-quiet-corners.md Phase 5, founder-ruled).
    if (opposesSignalId) {
      await recordContradiction(tx, {
        profileId: input.profileId,
        signalId: minted.id,
        opposesSignalId,
        now: input.now,
      });
    }

    if(input.reviewSource)await input.reviewSource.attach(tx,minted.id);
    else await attachEvidence(tx, {
      profileId: input.profileId,
      ownerProfileId: input.evidenceOwnerProfileId,
      signalId: minted.id,
      inspirationId: input.inspirationId!,
      reason: candidate.reason,
      quote: candidate.quote,
      quoteSource: candidate.quoteSource,
      quoteReflectionId: candidate.quoteReflectionId ?? null,
      quoteSourceHash: candidate.quoteSourceHash ?? null,
      material: input.material ?? null,
    });
    await attachRelatedEvidence(
      tx,
      {
        profileId: input.profileId,
        ownerProfileId: input.evidenceOwnerProfileId,
        signalId: minted.id,
      },
      candidate.relatedEvidence,
    );

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
      withdrawn: false,
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
  inputPolicy: string | undefined,
  inspirationId: string|null,
  ownerProfileId: string,
  reviewWithdrawn?:Set<string>,
): Promise<MatchTarget[]> {
  const reviews = inspirationId?await tx.selectDistinctOn([signalSupportReviews.signalId], {
    signalId: signalSupportReviews.signalId, verdict: signalSupportReviews.verdict,
  }).from(signalSupportReviews).where(and(eq(signalSupportReviews.profileId, profileId),
    eq(signalSupportReviews.ownerProfileId, ownerProfileId), eq(signalSupportReviews.inspirationId, inspirationId),
    ne(signalSupportReviews.verdict, "unresolved")))
    .orderBy(asc(signalSupportReviews.signalId), desc(signalSupportReviews.createdAt), desc(signalSupportReviews.reviewId)):[];
  const withdrawn = reviewWithdrawn??new Set(reviews.filter((row) => row.verdict === "unsupported").map((row) => row.signalId));
  const rows = await tx
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
      lockedAt: signals.lockedAt,
      embedding: signalEmbeddings.embedding,
      inputHash: signalEmbeddings.inputHash,
    })
    .from(signals)
    .innerJoin(signalEmbeddings, eq(signalEmbeddings.signalId, signals.id))
    .where(
      and(
        eq(signals.profileId, profileId),
        ...(inputPolicy ? [eq(signals.inputPolicy, inputPolicy)] : []),
        // Evidence-retired targets with an explicit refusal of THIS source
        // participate only to prevent re-minting, never to regain evidence.
        or(inArray(signals.status, ["emerging", "active"]), ...(withdrawn.size ? [
          and(eq(signals.status, "retired"), isNotNull(signals.supportRetiredAt), inArray(signals.id, [...withdrawn])),
        ] : [])),
        eq(signalEmbeddings.model, embeddingModel),
      ),
    )
    // Mandatory refusals must not fall outside the ordinary bounded scan.
    .orderBy(...(withdrawn.size ? [desc(inArray(signals.id, [...withdrawn]))] : []),
      desc(signals.lastEvidenceAt), asc(signals.id))
    .limit(MATCH_CANDIDATE_SCAN_LIMIT + withdrawn.size);

  return rows.filter(row => row.inputHash === hashEmbeddingInput(row.statement)).map((row) => ({
    id: row.id,
    statement: row.statement,
    status: row.status,
    locked: row.lockedAt !== null,
    withdrawn: withdrawn.has(row.id),
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

interface SuppressionAnchor {
  id: string;
  statement: string;
  embedding: number[];
}

/**
 * The vectors of the profile's dismissed signals. A dismissed row also
 * carries `status = retired`, so `loadMatchTargets` never sees it — this is
 * the other half of what dismissal means: the pattern stops being a home for
 * evidence AND becomes ground that refuses. Bounded and ordered like the
 * match scan, newest refusals first.
 */
async function loadSuppressionAnchors(
  tx: WakaTx,
  profileId: string,
  embeddingModel: string,
  inputPolicy?: string,
): Promise<SuppressionAnchor[]> {
  const rows = await tx
    .select({
      id: signals.id,
      statement: signals.statement,
      embedding: signalEmbeddings.embedding,
      inputHash: signalEmbeddings.inputHash,
    })
    .from(signals)
    .innerJoin(signalEmbeddings, eq(signalEmbeddings.signalId, signals.id))
    .where(
      and(
        eq(signals.profileId, profileId),
        ...(inputPolicy ? [eq(signals.inputPolicy, inputPolicy)] : []),
        isNotNull(signals.dismissedAt),
        eq(signalEmbeddings.model, embeddingModel),
      ),
    )
    .orderBy(desc(signals.dismissedAt), asc(signals.id))
    .limit(MATCH_CANDIDATE_SCAN_LIMIT);
  return rows.filter(row => row.inputHash === hashEmbeddingInput(row.statement));
}

function findSuppressionAnchor(
  candidate: Pick<ResolvedCandidate, 'statement' | 'embedding'>,
  anchors: SuppressionAnchor[],
): { anchor: SuppressionAnchor; similarity: number } | null {
  let best: { anchor: SuppressionAnchor; similarity: number } | null = null;

  for (const anchor of anchors) {
    const similarity = cosineSimilarity(candidate.embedding, anchor.embedding);
    if (similarity === null) continue;
    // An exact owner refusal wins even when a different nearby statement has
    // a higher cosine. Vectors retrieve meaning; they cannot overrule words.
    if (candidate.statement.trim() === anchor.statement.trim()) return { anchor, similarity };
    if (similarity < SIGNAL_SUPPRESSION_MIN_COSINE) continue;
    if (!best || similarity > best.similarity) best = { anchor, similarity };
  }

  return best;
}

async function attachEvidence(
  tx: WakaTx,
  input: {
    profileId: string;
    /** whose memory this row cites; the inspiration FK runs through it */
    ownerProfileId: string;
    signalId: string;
    inspirationId: string;
    reason: string | null;
    quote: string | null;
    quoteSource: "own" | "enrichment" | null;
    quoteReflectionId?: string | null;
    quoteSourceHash?: string | null;
    material?: InspirationMaterialIdentity | null;
  },
): Promise<void> {
  const [statement] = await tx.select({ revision: signals.statementRevision }).from(signals)
    .where(and(eq(signals.id, input.signalId), eq(signals.profileId, input.profileId))).limit(1);
  const materialRevision = await readInspirationRevision(tx, input.ownerProfileId, input.inspirationId,
    input.profileId === input.ownerProfileId ? 'personal' : 'public');
  if (!statement || materialRevision === null) throw new Error('Current evidence revision is unavailable');
  // Re-derivation after an edit revisits captures this signal already cites.
  // The unique index keeps a re-run from inflating support. Replace the old
  // quote and provenance with the material just verified, not the first copy.
  await tx
    .insert(signalEvidence)
    .values({
      profileId: input.profileId,
      ownerProfileId: input.ownerProfileId,
      signalId: input.signalId,
      inspirationId: input.inspirationId,
      reason: input.reason,
      quote: input.quote,
      quoteSource: input.quoteSource,
      quoteReflectionId: input.quoteReflectionId ?? null,
      quoteSourceHash: input.quoteSourceHash ?? null,
      material: input.material ?? null,
      statementRevision: statement.revision, materialRevision,
    })
    .onConflictDoUpdate({
      target: [signalEvidence.signalId, signalEvidence.inspirationId],
      set: { reason: input.reason, quote: input.quote, quoteSource: input.quoteSource,
        quoteReflectionId: input.quoteReflectionId ?? null, quoteSourceHash: input.quoteSourceHash ?? null,
        material: input.material ?? null, statementRevision: statement.revision, materialRevision },
    });
}

/**
 * The cited earlier captures become evidence of the same signal. Validated
 * upstream (offered ids only, verified quotes), and re-checked here against
 * the database inside the transaction: a cited capture deleted between
 * retrieval and this write is silently skipped rather than aborting the
 * whole pass on its foreign key. Production callers also validate the source
 * snapshot before this stage. Reason stays null — the quote IS the
 * grounding, and a reason describing the current capture would be attributed
 * to the wrong one. The unique (signal, inspiration) index updates the current
 * quote without manufacturing another witness.
 */
async function attachRelatedEvidence(
  tx: WakaTx,
  input: { profileId: string; ownerProfileId: string; signalId: string },
  cited: ResolvedCandidate["relatedEvidence"],
): Promise<void> {
  if (cited.length === 0) return;

  /* re-checked against the EVIDENCE OWNER's captures: the related memories
     were retrieved from the keeper's archive, and on a room pass that owner
     is not the deriving profile (the mind holds no captures at all) */
  const stillPresent = await tx
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.profileId, input.ownerProfileId),
        inArray(
          inspirations.id,
          cited.map((row) => row.inspirationId),
        ),
      ),
    );
  const presentIds = new Set(stillPresent.map((row) => row.id));
  const reviews = await tx.selectDistinctOn([signalSupportReviews.inspirationId], {
    inspirationId: signalSupportReviews.inspirationId, verdict: signalSupportReviews.verdict,
  }).from(signalSupportReviews).where(and(eq(signalSupportReviews.profileId, input.profileId),
    eq(signalSupportReviews.ownerProfileId, input.ownerProfileId), eq(signalSupportReviews.signalId, input.signalId),
    inArray(signalSupportReviews.inspirationId, cited.map((row) => row.inspirationId)), ne(signalSupportReviews.verdict, "unresolved")))
    .orderBy(asc(signalSupportReviews.inspirationId), desc(signalSupportReviews.createdAt), desc(signalSupportReviews.reviewId));
  const withdrawn = new Set(reviews.filter((row) => row.verdict === "unsupported").map((row) => row.inspirationId));

  for (const row of cited) {
    if (!presentIds.has(row.inspirationId) || withdrawn.has(row.inspirationId)) continue;
    await attachEvidence(tx, {
      profileId: input.profileId,
      ownerProfileId: input.ownerProfileId,
      signalId: input.signalId,
      inspirationId: row.inspirationId,
      material: row.material ?? null,
      quoteSourceHash: row.quoteSourceHash ?? null,
      reason: null,
      quote: row.quote,
      /* `resolveRelatedEvidence` verifies against the capture's own text with
         no enrichment offered, so a surviving quote is the person's words */
      quoteSource: "own",
    });
  }
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
