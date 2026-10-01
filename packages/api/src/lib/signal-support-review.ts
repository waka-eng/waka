/** Read-only shadow assessment before support withdrawal is enabled.
 * Reports contain identities/verdicts, never source text. A report is not a
 * write authorization: any future writer must recheck under transaction locks.
 */
import { and, asc, eq } from "drizzle-orm";
import { signalEvidence, signals } from "../db/index.js";
import { getDb } from "./db.js";
import { hashEmbeddingInput } from "./inspiration-embeddings.js";
import { loadInspirationMaterial, type InspirationMaterial } from "./inspiration-material.js";
import { GROUP_INPUT_POLICY, GroupInputUnavailableError, loadGroupInputMembership } from "./group-inputs.js";
import type { ModelProvider, SignalSupportAssessmentInput } from "./model-provider.js";

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
  deriveIntoProfileId?: string;
  provider: Pick<ModelProvider, "assessSignalSupport">;
  maxCalls: number;
}) {
  const destination = input.deriveIntoProfileId ?? input.ownerProfileId;
  const isGroup = input.deriveIntoProfileId !== undefined;
  const membership = isGroup ? await loadGroupInputMembership(db, input.ownerProfileId, destination) : null;
  if (isGroup && !membership) throw new GroupInputUnavailableError("not_authorized");
  const loadMaterial = () => loadInspirationMaterial(db, input.ownerProfileId, input.inspirationId, isGroup ? "public" : "personal");
  const material = await loadMaterial();
  if (!material) throw new GroupInputUnavailableError("missing_inspiration");
  if (isGroup && material.inspiration.visibility !== "public") throw new GroupInputUnavailableError("not_public");
  const loadClaims = () => db.select({ signalId: signals.id, statement: signals.statement,
    lockedAt: signals.lockedAt, dismissedAt: signals.dismissedAt, status: signals.status,
    inputPolicy: signals.inputPolicy, evidenceId: signalEvidence.id })
    .from(signalEvidence).innerJoin(signals, eq(signals.id, signalEvidence.signalId))
    .where(and(eq(signalEvidence.profileId, destination), eq(signalEvidence.ownerProfileId, input.ownerProfileId),
      eq(signalEvidence.inspirationId, input.inspirationId)))
    .orderBy(asc(signals.id));
  const allClaims = await loadClaims();
  // Old room text itself can contain private material. Never feed it to a
  // new public assessment merely because its remaining inspirations are public.
  const claims = allClaims.filter((row) => !isGroup || row.inputPolicy === GROUP_INPUT_POLICY);
  const assessed = await assessExistingClaims({ material,
    claims: claims.map(({ signalId, statement }) => ({ signalId, statement })),
    provider: input.provider, maxCalls: input.maxCalls });
  const currentMaterial = await loadMaterial();
  const currentClaims = await loadClaims();
  const currentMembership = isGroup ? await loadGroupInputMembership(db, input.ownerProfileId, destination) : null;
  const current = currentMaterial?.identity.hash === material.identity.hash &&
    JSON.stringify(allClaims) === JSON.stringify(currentClaims) &&
    (!isGroup || currentMembership?.id === membership?.id);
  return {
    policy: SIGNAL_SUPPORT_REVIEW_POLICY,
    status: current ? "current" as const : "stale" as const,
    profileId: destination,
    inspirationId: input.inspirationId,
    material: material.identity,
    restrictedClaimCount: allClaims.length - claims.length,
    calls: assessed.calls,
    items: assessed.items.map((item): SignalSupportReviewItem => current ? item : {
      ...item, verdict: "unresolved", sourceIds: [], issue: "inputs_changed",
    }),
  };
}
