/**
 * Match-or-mint: deciding whether a candidate statement is a pattern the
 * profile already holds, or a new one.
 *
 * The decision is COSINE DISTANCE on embeddings, not a model verdict. A
 * candidate's vector is compared against the profile's existing signal vectors
 * and `classifyMatch` reads the number: above the match bar it attaches as
 * evidence, below the judge band it mints. That is deliberate and it is the
 * reason the thresholds are named exports in
 * `signal-derivation-thresholds.ts` — the behaviour of this stage is tunable
 * arithmetic a test can pin down exactly, not a prompt whose answer changes
 * when a provider ships a new checkpoint.
 *
 * There is exactly one model call in this file, and it is a tie-breaker: in
 * the band between the two bars, distance alone genuinely cannot tell one
 * pattern reworded from two patterns sharing a vocabulary, so the single
 * nearest candidate gets one bounded judge call. It can only move a decision
 * within the band, it is never asked above or below it, and any failure of it
 * falls through to minting. Nothing about which signals exist rests on the
 * model being available.
 *
 * The lock rule is enforced downstream of the match: a signal whose `lockedAt`
 * is set never has its statement rewritten here, no matter how the candidate
 * that matched it is worded. See `restateSignal`.
 *
 * Upstream of the match sits the ground's refusal: a candidate at or above
 * `SIGNAL_SUPPRESSION_MIN_COSINE` to a DISMISSED signal's vector is dropped
 * before any of the above runs, and every refusal writes a `suppressions`
 * row naming its anchor. Arithmetic only, no model — and checked first, so a
 * pattern the owner threw out cannot re-enter as evidence for something else
 * (goals/the-legible-loop.md Phase 3).
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  inspirations,
  signalEmbeddings,
  signalEvidence,
  signals,
  suppressions,
  type SignalStatus,
} from "../db/index.js";
import { cosineSimilarity } from "../scoring/vector.js";
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
  embedding: number[];
}

export interface ResolvedCandidate {
  statement: string;
  reason: string | null;
  quote: string | null;
  /** Whose words the verified quote is; null when quote is null. */
  quoteSource: "own" | "enrichment" | null;
  embedding: number[];
  /**
   * Earlier captures of the same profile that co-witness this pattern —
   * already validated upstream (`resolveRelatedEvidence`): each id was one
   * the extractor was actually shown, and each quote is a verified verbatim
   * span of that capture's own text. Attached as ordinary evidence rows for
   * whatever signal this candidate lands on, dated by their own capture
   * dates via the lifecycle read.
   */
  relatedEvidence: Array<{ inspirationId: string; quote: string }>;
}

interface ApplyCandidatesInput {
  profileId: string;
  inspirationId: string;
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
}

export async function applyCandidates(
  tx: WakaTx,
  input: ApplyCandidatesInput,
): Promise<Pick<SignalDerivationResult, "matchedSignalIds" | "mintedSignalIds" | "promotedSignalIds">> {
  const targets = await loadMatchTargets(tx, input.profileId, input.embeddingModel);
  const anchors = await loadSuppressionAnchors(tx, input.profileId, input.embeddingModel);

  const matchedSignalIds: string[] = [];
  const mintedSignalIds: string[] = [];
  const touched = new Set<string>();

  for (const candidate of input.candidates) {
    // The ground refuses first, before the match is even looked at. A
    // dismissed signal is a pattern its owner threw out; a candidate this
    // close to one IS that pattern, and letting the match see it would
    // re-admit it as evidence for something else — or spend a judge call
    // deciding the fate of a sentence whose fate the owner already decided.
    // Every refusal is written down: the silence this creates is a logged,
    // legible silence, and restoring the anchor ends it.
    const refused = findSuppressionAnchor(candidate.embedding, anchors);
    if (refused) {
      await tx.insert(suppressions).values({
        profileId: input.profileId,
        anchorSignalId: refused.anchor.id,
        anchorStatement: refused.anchor.statement,
        inspirationId: input.inspirationId,
        candidateStatement: candidate.statement,
        similarity: refused.similarity,
      });
      continue;
    }

    const nearest = findBestMatch(candidate.embedding, targets);
    let decision = classifyMatch(nearest?.similarity ?? null);
    /** Set when the judge answers `opposed`: the mint below also records
        the contested pair — the dispute is held, never dissolved by
        whichever statement arrived second. */
    let opposesSignalId: string | null = null;

    if (decision === "judge" && nearest) {
      // One bounded model call, held under the per-profile derivation lock.
      // Serializing a ~second of judgement is the price of the lock's whole
      // point: two concurrent captures must not each mint the same pattern.
      //
      // A judge failure PROPAGATES and fails the job attempt (it used to
      // fall through to minting as `independent` — which called the
      // duplicate "the recoverable mistake" while nothing ever revisited
      // it: a bad provider hour minted siblings that split their evidence
      // forever). The queue retries the attempt; evidence uniqueness and
      // the dedupe band make the rerun safe. A phantom opposition is still
      // impossible: no verdict is invented on any path.
      const judged = await input.provider.judgeSignalMatch({
        preferredLocale: input.preferredLocale,
        candidateStatement: candidate.statement,
        existingStatement: nearest.target.statement,
      });
      decision = judged.relation === "same" ? "attach" : "mint";
      if (judged.relation === "opposed") opposesSignalId = nearest.target.id;
    }

    const match = decision === "attach" ? nearest : null;

    if (match) {
      await attachEvidence(tx, {
        profileId: input.profileId,
        ownerProfileId: input.evidenceOwnerProfileId,
        signalId: match.target.id,
        inspirationId: input.inspirationId,
        reason: candidate.reason,
        quote: candidate.quote,
        quoteSource: candidate.quoteSource,
      });
      await attachRelatedEvidence(
        tx,
        {
          profileId: input.profileId,
          ownerProfileId: input.evidenceOwnerProfileId,
          signalId: match.target.id,
        },
        candidate.relatedEvidence,
      );

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

    await attachEvidence(tx, {
      profileId: input.profileId,
      ownerProfileId: input.evidenceOwnerProfileId,
      signalId: minted.id,
      inspirationId: input.inspirationId,
      reason: candidate.reason,
      quote: candidate.quote,
      quoteSource: candidate.quoteSource,
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
): Promise<SuppressionAnchor[]> {
  return tx
    .select({
      id: signals.id,
      statement: signals.statement,
      embedding: signalEmbeddings.embedding,
    })
    .from(signals)
    .innerJoin(signalEmbeddings, eq(signalEmbeddings.signalId, signals.id))
    .where(
      and(
        eq(signals.profileId, profileId),
        isNotNull(signals.dismissedAt),
        eq(signalEmbeddings.model, embeddingModel),
      ),
    )
    .orderBy(desc(signals.dismissedAt))
    .limit(MATCH_CANDIDATE_SCAN_LIMIT);
}

function findSuppressionAnchor(
  embedding: number[],
  anchors: SuppressionAnchor[],
): { anchor: SuppressionAnchor; similarity: number } | null {
  let best: { anchor: SuppressionAnchor; similarity: number } | null = null;

  for (const anchor of anchors) {
    const similarity = cosineSimilarity(embedding, anchor.embedding);
    if (similarity === null || similarity < SIGNAL_SUPPRESSION_MIN_COSINE) continue;
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
      ownerProfileId: input.ownerProfileId,
      signalId: input.signalId,
      inspirationId: input.inspirationId,
      reason: input.reason,
      quote: input.quote,
      quoteSource: input.quoteSource,
    })
    .onConflictDoNothing();
}

/**
 * The cited earlier captures become evidence of the same signal. Validated
 * upstream (offered ids only, verified quotes), and re-checked here against
 * the database inside the transaction: a cited capture deleted between
 * retrieval and this write is silently skipped rather than aborting the
 * whole pass on its foreign key. Reason stays null — the quote IS the
 * grounding, and a reason describing the current capture would be attributed
 * to the wrong one. The unique (signal, inspiration) index makes re-runs and
 * already-evidencing captures a no-op, as everywhere else.
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

  for (const row of cited) {
    if (!presentIds.has(row.inspirationId)) continue;
    await attachEvidence(tx, {
      profileId: input.profileId,
      ownerProfileId: input.ownerProfileId,
      signalId: input.signalId,
      inspirationId: row.inspirationId,
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
