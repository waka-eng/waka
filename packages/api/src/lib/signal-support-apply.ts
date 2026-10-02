/** Applies an explicitly reviewed metadata report. No model calls and no raw
 * source snapshots are accepted. Automatic derivation remains a separate gate. */
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { groupMembers, principleSignals, profiles, signalEvidence, signals, signalSupportReviews } from "../db/index.js";
import { getDb } from "./db.js";
import { GROUP_INPUT_POLICY } from "./group-inputs.js";
import { hashEmbeddingInput } from "./inspiration-embeddings.js";
import { loadInspirationMaterial } from "./inspiration-material.js";
import { promoteIfDemonstrated, reconcilePrinciplesAfterSignalLoss } from "./principle-generation.js";
import { enqueueGroupTopOfMindRefresh, enqueueTopOfMindRefresh, type EnqueueResult } from "./queue.js";
import { reconcileSignalsAfterEvidenceLoss, refreshSignalLifecycle } from "./signal-lifecycle.js";
import { acquireSignalDerivationLock } from "./signal-match-or-mint.js";
import { loadSupportClaims, SIGNAL_SUPPORT_REVIEW_POLICY, SUPPORT_REVIEW_BATCH_SIZE, supportClaimsHash, supportReviewSources } from "./signal-support-review.js";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reportSchema = z.object({
  reviewId: uuid, policy: z.literal(SIGNAL_SUPPORT_REVIEW_POLICY), status: z.literal("current"),
  profileId: uuid, ownerProfileId: uuid, membershipId: uuid.nullable(), inspirationId: uuid,
  claimsHash: hash, calls: z.number().int().min(0).max(10), restrictedClaimCount: z.number().int().min(0),
  signalIds: z.array(uuid).min(1).max(SUPPORT_REVIEW_BATCH_SIZE).optional(),
  material: z.object({ scope: z.enum(["personal", "public"]),
    revision: z.string().regex(/^[1-9]\d*$/).optional(),
    policy: z.literal("inspiration-material-v1"), hash,
    sources: z.array(z.object({ kind: z.enum(["inspiration", "reflection", "attachment"]), id: uuid, hash }).strict()),
  }).strict(),
  items: z.array(z.object({ signalId: uuid, statementHash: hash,
    verdict: z.enum(["supported", "unsupported", "unresolved"]), sourceIds: z.array(uuid),
    issue: z.enum(["missing_verdict", "invalid_verdict", "provider_unavailable", "budget_exhausted",
      "input_too_large", "incomplete_material", "inputs_changed"]).optional(),
  }).strict()),
}).strict();

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

export async function applySignalSupportReview(db: WakaDb, reportInput: unknown,
  deps: { beforeCommit?: (tx: WakaTx) => Promise<void>; onReadingRequested?: (tx: WakaTx, job: EnqueueResult) => Promise<void> } = {}) {
  const report = reportSchema.parse(reportInput);
  const reportHash = hashEmbeddingInput(JSON.stringify(report));
  if (new Set(report.items.map((row) => row.signalId)).size !== report.items.length) throw new Error("Duplicate support review claims");
  if (report.signalIds && new Set(report.signalIds).size !== report.signalIds.length) throw new Error('Duplicate support batch scope');
  const isGroup = report.profileId !== report.ownerProfileId;
  if (report.material.scope !== (isGroup ? "public" : "personal")) throw new Error("Support review scope mismatch");

  return db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx, report.profileId);
    const prior = await tx.select({ reviewHash: signalSupportReviews.reviewHash }).from(signalSupportReviews)
      .where(eq(signalSupportReviews.reviewId, report.reviewId));
    if (prior.length) {
      if (prior.length !== report.items.length || prior.some((row) => row.reviewHash !== reportHash)) throw new Error("Support review identity reused");
      return { alreadyApplied: true, withdrawn: [] as string[], restored: [] as string[], jobId: null as string | null };
    }

    const [membership] = isGroup ? await tx.select({ id: groupMembers.id, groupId: groupMembers.groupId })
      .from(groupMembers).innerJoin(profiles, and(eq(profiles.groupId, groupMembers.groupId), eq(profiles.type, "group")))
      .where(and(eq(profiles.id, report.profileId), eq(groupMembers.profileId, report.ownerProfileId)))
      .for("share") : [];
    if (isGroup && (!membership || membership.id !== report.membershipId)) throw new Error("Support review membership changed");
    if (!isGroup && report.membershipId !== null) throw new Error("Unexpected support review membership");
    const material = await loadInspirationMaterial(tx, report.ownerProfileId, report.inspirationId, report.material.scope, true);
    if (!material || material.identity.hash !== report.material.hash ||
      (report.material.revision !== undefined && material.identity.revision !== report.material.revision) ||
      (isGroup && material.inspiration.visibility !== "public")) throw new Error("Support review material changed");

    const selected = report.signalIds ? new Set(report.signalIds) : null;
    const beforeLocks = (await loadSupportClaims(tx, report.profileId, report.ownerProfileId, report.inspirationId))
      .filter((claim) => !selected || selected.has(claim.signalId));
    if (selected && beforeLocks.length !== selected.size) throw new Error('Support batch scope changed');
    if (beforeLocks.length) await tx.select({ id: signals.id }).from(signals)
      .where(and(eq(signals.profileId, report.profileId), inArray(signals.id, beforeLocks.map((row) => row.signalId))))
      .orderBy(asc(signals.id)).for("no key update");
    const current = (await loadSupportClaims(tx, report.profileId, report.ownerProfileId, report.inspirationId))
      .filter((claim) => !selected || selected.has(claim.signalId));
    if (supportClaimsHash(current) !== report.claimsHash) throw new Error("Support review claims changed");
    const allowed = current.filter((row) => !isGroup || row.inputPolicy === GROUP_INPUT_POLICY);
    if (allowed.length !== report.items.length) throw new Error("Support review claim coverage mismatch");
    const sources = new Set(supportReviewSources(material).map((row) => row.id));
    const withdrawn: string[] = [];
    const restored: string[] = [];
    const now = new Date();
    await deps.beforeCommit?.(tx);
    for (const item of report.items) {
      const claim = allowed.find((row) => row.signalId === item.signalId);
      if (!claim || hashEmbeddingInput(claim.statement) !== item.statementHash) throw new Error("Support review statement changed");
      if (item.sourceIds.some((id) => !sources.has(id)) ||
        (item.verdict === "supported" && !item.sourceIds.length) ||
        (item.verdict !== "unresolved" && item.issue)) throw new Error("Invalid support review verdict");
      if (item.verdict === "unsupported" && material.attachmentRows.some((row) => row.status !== "ready" || row.text === null)) {
        throw new Error("Support review material incomplete");
      }
      // The positive decision must exist before restoring a link: the DB
      // guard prevents an older/unaware writer from undoing withdrawal.
      await tx.insert(signalSupportReviews).values({ reviewId: report.reviewId, reviewHash: reportHash,
        policy: report.policy,
        profileId: report.profileId, ownerProfileId: report.ownerProfileId, inspirationId: report.inspirationId,
        signalId: item.signalId, statementHash: item.statementHash, statementRevision: BigInt(claim.statementRevision), material: material.identity,
        verdict: item.verdict, issue: item.issue ?? null, sourceIds: item.sourceIds });
      if (item.verdict === "unsupported") {
        const removed = await tx.delete(signalEvidence).where(and(eq(signalEvidence.profileId, report.profileId),
          eq(signalEvidence.ownerProfileId, report.ownerProfileId), eq(signalEvidence.signalId, item.signalId),
          eq(signalEvidence.inspirationId, report.inspirationId))).returning({ id: signalEvidence.id });
        if (removed.length) withdrawn.push(item.signalId);
      } else if (item.verdict === 'supported' && claim.evidenceId) {
        const renewed = claim.evidenceCurrent !== true;
        await tx.update(signalEvidence).set({ statementRevision: BigInt(claim.statementRevision),
          materialRevision: BigInt(material.identity.revision!), material: material.identity,
          ...(renewed ? { reason: null, quote: null, quoteSource: null, quoteReflectionId: null, quoteSourceHash: null } : {}) })
          .where(eq(signalEvidence.id, claim.evidenceId));
        if (renewed) restored.push(item.signalId);
      } else if (item.verdict === "supported" && !claim.evidenceId && claim.dismissedAt === null &&
        (claim.status !== "retired" || claim.supportRetiredAt !== null)) {
        // Restore only the relationship. Deleted quotes/reasons never return.
        await tx.insert(signalEvidence).values({ profileId: report.profileId, ownerProfileId: report.ownerProfileId,
          signalId: item.signalId, inspirationId: report.inspirationId, material: material.identity,
          statementRevision: BigInt(claim.statementRevision), materialRevision: BigInt(material.identity.revision!) });
        restored.push(item.signalId);
      }
    }
    await reconcileSignalsAfterEvidenceLoss(tx, { profileId: report.profileId, signalIds: withdrawn });
    for (const id of restored) await refreshSignalLifecycle(tx, id, now);
    await reconcilePrinciplesAfterSignalLoss(tx, { profileId: report.profileId, signalIds: withdrawn, now });
    if (restored.length) {
      const affected = await tx.selectDistinct({ id: principleSignals.principleId }).from(principleSignals)
        .where(and(eq(principleSignals.profileId, report.profileId), inArray(principleSignals.signalId, restored)));
      for (const row of affected) await promoteIfDemonstrated(tx, report.profileId, row.id, now);
    }
    const changed = withdrawn.length + restored.length > 0;
    const job = !changed ? null : membership
      ? await enqueueGroupTopOfMindRefresh(report.ownerProfileId, membership.groupId, "signals_changed", tx)
      : await enqueueTopOfMindRefresh(report.profileId, "signals_changed", tx);
    if (job) await deps.onReadingRequested?.(tx, job);
    return { alreadyApplied: false, withdrawn, restored, jobId: job?.jobId ?? null };
  });
}
