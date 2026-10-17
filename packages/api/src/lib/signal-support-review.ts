/** Read-only assessment, shared by automatic derivation and explicit review.
 * Reports contain identities/verdicts, never source text. A report is not a
 * write authorization: the explicit apply path rechecks under transaction locks.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { signalEvidence, signals, signalSupportReviews } from "../db/index.js";
import { getDb } from "./db.js";
import { hashEmbeddingInput } from "./inspiration-embeddings.js";
import { loadInspirationMaterial, type InspirationMaterial } from "./inspiration-material.js";
import type { ModelProvider, SignalSupportAssessmentInput } from "./model-provider.js";
import { evidenceSupportCurrent } from './signal-support-state.js';

/** The assessed source is gone. An ordinary outcome, not a retryable fault.
 * (Was `GroupInputUnavailableError` from the retired room input contract,
 * whose other two statuses only a room pass could produce.) */
export class SupportSourceUnavailableError extends Error {
  readonly status = "missing_inspiration" as const;
  constructor() {
    super("Support source unavailable: missing_inspiration");
  }
}

export const SIGNAL_SUPPORT_REVIEW_POLICY = "signal-support-review-v1";
export const SUPPORT_REVIEW_BATCH_SIZE = 12;
export const SUPPORT_REVIEW_MAX_INPUT_CHARS = 64_000;
type ReviewIssue = "missing_verdict" | "invalid_verdict" | "provider_unavailable" |
  "budget_exhausted" | "input_too_large" | "incomplete_material" | "inputs_changed";
export interface SignalSupportReviewItem {
  signalId: string;
  statementHash: string;
  verdict: "supported" | "unsupported" | "unresolved";
  sourceIds: string[];
  issue?: ReviewIssue;
}

/** Current links plus previously assessed links: a withdrawn witness remains
 * eligible for a new explicit assessment without retaining its old words. */
export async function loadSupportClaims(db: Pick<ReturnType<typeof getDb>, "select">,
  profileId: string, ownerProfileId: string, inspirationId: string) {
  return db.select({ signalId: signals.id, statement: signals.statement,
    statementRevision: sql<string>`${signals.statementRevision}::text`,
    evidenceCurrent: evidenceSupportCurrent(),
    lockedAt: signals.lockedAt, dismissedAt: signals.dismissedAt, status: signals.status,
    supportRetiredAt: signals.supportRetiredAt, inputPolicy: signals.inputPolicy, evidenceId: signalEvidence.id,
    lastReviewId: sql<string | null>`(SELECT r.review_id FROM signal_support_reviews r
      WHERE r.signal_id = ${signals.id} AND r.owner_profile_id = ${ownerProfileId}::uuid
      AND r.inspiration_id = ${inspirationId}::uuid ORDER BY r.created_at DESC, r.review_id DESC LIMIT 1)`,
  }).from(signals).leftJoin(signalEvidence, and(eq(signalEvidence.signalId, signals.id),
    eq(signalEvidence.ownerProfileId, ownerProfileId), eq(signalEvidence.inspirationId, inspirationId)))
    .where(and(eq(signals.profileId, profileId), or(isNotNull(signalEvidence.id), sql`EXISTS (
      SELECT 1 FROM signal_support_reviews r WHERE r.signal_id = ${signals.id}
      AND r.owner_profile_id = ${ownerProfileId}::uuid AND r.inspiration_id = ${inspirationId}::uuid)`)))
    .orderBy(asc(signals.id));
}

export function supportClaimsHash(claims: Awaited<ReturnType<typeof loadSupportClaims>>) {
  return hashEmbeddingInput(JSON.stringify(claims));
}

export function supportReviewSources(material: InspirationMaterial): SignalSupportAssessmentInput["sources"] {
  return [
    { id: material.inspiration.id, kind: "inspiration", text: material.inspiration.text },
    ...material.reflectionRows.map((row) => ({ id: row.id, kind: "reflection" as const,
      text: `Question (context, not the person's words): ${row.question}\nAnswer: ${row.answer ?? ""}` })),
    ...material.attachmentRows.filter((row) => row.status === "ready" && row.text !== null)
      .map((row) => ({ id: row.id, kind: "attachment" as const, text: row.text! })),
  ];
}

/** Budget counts attempted provider calls, including failures. No truncation
 * may turn unseen material or an omitted claim into negative evidence. */
export async function assessExistingClaims(input: {
  material: InspirationMaterial;
  claims: SignalSupportAssessmentInput["claims"];
  provider: Pick<ModelProvider, "assessSignalSupport">;
  maxCalls: number;
}) {
  if (!Number.isInteger(input.maxCalls) || input.maxCalls < 0 || input.maxCalls > 10) {
    throw new Error("Support review maxCalls must be an integer from 0 to 10");
  }
  if (new Set(input.claims.map((row) => row.signalId)).size !== input.claims.length) {
    throw new Error("Support review claims must be unique");
  }
  const sources = supportReviewSources(input.material);
  const sourceIds = new Set(sources.map((source) => source.id));
  const incomplete = input.material.attachmentRows.some((row) => row.status !== "ready" || row.text === null);
  const items: SignalSupportReviewItem[] = input.claims.map((claim) => ({
    signalId: claim.signalId, statementHash: hashEmbeddingInput(claim.statement),
    verdict: "unresolved", sourceIds: [], issue: "budget_exhausted",
  }));
  let calls = 0;
  for (let start = 0; start < input.claims.length; start += SUPPORT_REVIEW_BATCH_SIZE) {
    const claims = input.claims.slice(start, start + SUPPORT_REVIEW_BATCH_SIZE);
    const batch = items.slice(start, start + SUPPORT_REVIEW_BATCH_SIZE);
    if (JSON.stringify({ sources, claims }).length > SUPPORT_REVIEW_MAX_INPUT_CHARS) {
      for (const item of batch) item.issue = "input_too_large";
      continue;
    }
    if (calls >= input.maxCalls) continue;
    calls += 1;
    try {
      const result = await input.provider.assessSignalSupport({ sources, claims });
      for (const item of batch) {
        const answers = result.assessments.filter((row) => row.signalId === item.signalId);
        const answer = answers[0];
        if (!answer) { item.issue = "missing_verdict"; continue; }
        if (answers.length !== 1 || !["supported", "unsupported", "unresolved"].includes(answer.verdict) ||
          !Array.isArray(answer.sourceIds) || answer.sourceIds.some((id) => !sourceIds.has(id)) ||
          (answer.verdict === "supported" && answer.sourceIds.length === 0)) {
          item.issue = "invalid_verdict";
          continue;
        }
        if (answer.verdict === "unsupported" && incomplete) { item.issue = "incomplete_material"; continue; }
        item.verdict = answer.verdict;
        item.sourceIds = [...new Set(answer.sourceIds)];
        delete item.issue;
      }
    } catch {
      // Do not retain provider messages: they may echo private source content.
      for (const item of batch) { item.verdict = "unresolved"; item.sourceIds = []; item.issue = "provider_unavailable"; }
    }
  }
  return { calls, items };
}

export async function reviewSignalSupport(db: ReturnType<typeof getDb>, input: {
  ownerProfileId: string;
  inspirationId: string;
  provider: Pick<ModelProvider, "assessSignalSupport">;
  maxCalls: number;
  /** Worker retries reuse checks only for identical material and words.
   * Explicit/operator reviews default to a fresh independent check. */
  reuseCurrentAssessments?: boolean;
  /** Explicit batch scope; absence means exhaustive source coverage. */
  signalIds?: string[];
  /** Queue batches must assess the version they were scheduled for. */
  expectedInputs?: { materialRevision: string; materialHash: string; membershipId: string | null;
    statements: Array<{ id: string; revision: string; hash: string }> };
}) {
  // Support lands on the source's own profile: the room destination (a
  // mind, public material only, membership-gated) retired with the engine.
  const destination = input.ownerProfileId;
  const loadMaterial = () => loadInspirationMaterial(db, input.ownerProfileId, input.inspirationId, "personal");
  const material = await loadMaterial();
  if (!material) throw new SupportSourceUnavailableError();
  const loadClaims = () => loadSupportClaims(db, destination, input.ownerProfileId, input.inspirationId);
  const loadedClaims = await loadClaims();
  const selected = input.signalIds ? new Set(input.signalIds) : null;
  if (selected && (selected.size !== input.signalIds!.length || selected.size === 0 || selected.size > SUPPORT_REVIEW_BATCH_SIZE ||
    input.signalIds!.some((id) => !loadedClaims.some((claim) => claim.signalId === id)))) throw new Error('Invalid support batch scope');
  const allClaims = selected ? loadedClaims.filter((claim) => selected.has(claim.signalId)) : loadedClaims;
  // Every claim is assessable on a personal pass; only a room pass restricted
  // claims by input policy.
  const claims = allClaims;
  if (input.expectedInputs) {
    const expected = input.expectedInputs;
    if (expected.materialRevision !== material.identity.revision || expected.materialHash !== material.identity.hash ||
      expected.membershipId !== null || expected.statements.length !== claims.length ||
      expected.statements.some((statement) => !claims.some((claim) => claim.signalId === statement.id &&
        claim.statementRevision === statement.revision && hashEmbeddingInput(claim.statement) === statement.hash))) {
      throw new Error('Support batch inputs changed before assessment');
    }
  }
  const previous = input.reuseCurrentAssessments ? await db.selectDistinctOn([signalSupportReviews.signalId], {
    signalId: signalSupportReviews.signalId, statementHash: signalSupportReviews.statementHash,
    statementRevision: sql<string | null>`${signalSupportReviews.statementRevision}::text`,
    material: signalSupportReviews.material, verdict: signalSupportReviews.verdict,
    policy: signalSupportReviews.policy,
    sourceIds: signalSupportReviews.sourceIds, issue: signalSupportReviews.issue,
  }).from(signalSupportReviews).where(and(eq(signalSupportReviews.profileId, destination),
    eq(signalSupportReviews.ownerProfileId, input.ownerProfileId), eq(signalSupportReviews.inspirationId, input.inspirationId)))
    .orderBy(asc(signalSupportReviews.signalId), desc(signalSupportReviews.createdAt), desc(signalSupportReviews.reviewId)) : [];
  const reused = new Map<string, SignalSupportReviewItem>();
  for (const claim of claims) {
    const prior = previous.find((row) => row.signalId === claim.signalId);
    if (prior && prior.policy === SIGNAL_SUPPORT_REVIEW_POLICY && prior.material?.hash === material.identity.hash &&
      prior.material?.revision === material.identity.revision && prior.statementRevision === claim.statementRevision &&
      prior.statementHash === hashEmbeddingInput(claim.statement) && prior.issue === null) {
      reused.set(claim.signalId, { signalId: claim.signalId, statementHash: prior.statementHash,
        verdict: prior.verdict, sourceIds: prior.sourceIds });
    }
  }
  const assessed = await assessExistingClaims({ material,
    claims: claims.filter((row) => !reused.has(row.signalId)).map(({ signalId, statement }) => ({ signalId, statement })),
    provider: input.provider, maxCalls: input.maxCalls });
  const currentMaterial = await loadMaterial();
  const currentClaims = (await loadClaims()).filter((claim) => !selected || selected.has(claim.signalId));
  const current = currentMaterial?.identity.hash === material.identity.hash &&
    currentMaterial?.identity.revision === material.identity.revision &&
    JSON.stringify(allClaims) === JSON.stringify(currentClaims);
  return {
    reviewId: randomUUID(),
    policy: SIGNAL_SUPPORT_REVIEW_POLICY,
    status: current ? "current" as const : "stale" as const,
    profileId: destination,
    ownerProfileId: input.ownerProfileId,
    membershipId: null,
    inspirationId: input.inspirationId,
    claimsHash: supportClaimsHash(allClaims),
    ...(input.signalIds ? { signalIds: input.signalIds } : {}),
    material: material.identity,
    restrictedClaimCount: allClaims.length - claims.length,
    calls: assessed.calls,
    items: claims.map((claim) => reused.get(claim.signalId) ?? assessed.items.find((item) => item.signalId === claim.signalId)!)
      .map((item): SignalSupportReviewItem => current ? item : {
      ...item, verdict: "unresolved", sourceIds: [], issue: "inputs_changed",
    }),
  };
}
