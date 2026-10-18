/** Large-source coverage: separately metered calls with immutable semantic
 * scope. Partial reports never certify full source derivation. */
import { sql } from 'drizzle-orm';
import type { getDb } from './db.js';
import type { AssessSignalSupportPayload } from '../db/index.js';
import { BackgroundJobHeldError } from './background-job-hold.js';
import { hashEmbeddingInput } from './inspiration-embeddings.js';
import { assertMaterialCurrent, loadInspirationMaterial } from './inspiration-material.js';
import { acquireSignalDerivationLock } from './signal-match-or-mint.js';
import { enqueueSignalSupportBatch } from './queue.js';
import { loadSupportClaims, reviewSignalSupport, SIGNAL_SUPPORT_REVIEW_POLICY, SUPPORT_REVIEW_BATCH_SIZE } from './signal-support-review.js';
import type { ModelProvider } from './model-provider.js';

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function ensureSupportBatchCoverage(db: Database, input: {
  ownerProfileId: string; inspirationId: string;
  provider: Pick<ModelProvider, 'assessSignalSupport'>;
  beforeCommit: (tx: Transaction) => Promise<void>;
}) {
  // Personal coverage only: room destinations retired with the room engine.
  const destination = input.ownerProfileId;
  const claims = await loadSupportClaims(db, destination, destination, input.inspirationId);
  if (claims.length <= SUPPORT_REVIEW_BATCH_SIZE) return;
  const report = await reviewSignalSupport(db, { ...input, maxCalls: 0, reuseCurrentAssessments: true });
  if (report.status !== 'current') throw new Error('Support inputs changed before planning');
  const pending = new Set(report.items.filter((item) => item.issue !== undefined).map((item) => item.signalId));
  if (!pending.size) return;
  let failed = false;
  await db.transaction(async (tx) => {
    await acquireSignalDerivationLock(tx, destination);
    const material = await loadInspirationMaterial(tx, input.ownerProfileId, input.inspirationId, report.material.scope, true);
    if (!material || material.identity.revision !== report.material.revision || material.identity.hash !== report.material.hash) {
      throw new Error('Support material changed before planning');
    }
    await assertMaterialCurrent(tx, material, []);
    const current = await loadSupportClaims(tx, destination, input.ownerProfileId, input.inspirationId);
    if (claims.some((claim) => !current.some((row) => row.signalId === claim.signalId && row.statementRevision === claim.statementRevision))) {
      throw new Error('Support statements changed before planning');
    }
    await input.beforeCommit(tx);
    for (let start = 0; start < claims.length; start += SUPPORT_REVIEW_BATCH_SIZE) {
      const batch = claims.slice(start, start + SUPPORT_REVIEW_BATCH_SIZE);
      if (!batch.some((claim) => pending.has(claim.signalId))) continue;
      const payload: AssessSignalSupportPayload = {
        inspirationId: input.inspirationId,
        signalIds: batch.map((claim) => claim.signalId), materialRevision: report.material.revision!, materialHash: report.material.hash,
        statements: batch.map((claim) => ({ id: claim.signalId, revision: claim.statementRevision, hash: hashEmbeddingInput(claim.statement) })),
      };
      const key = supportBatchKey(input.ownerProfileId, payload);
      const [job] = await tx.execute<{ status: string }>(sql`SELECT status::text FROM background_jobs
        WHERE idempotency_key = ${key} AND profile_id = ${input.ownerProfileId}::uuid`);
      if (job?.status === 'failed') { failed = true; continue; }
      if (!job || job.status === 'succeeded') await enqueueSignalSupportBatch(input.ownerProfileId, payload, key, tx);
    }
  });
  if (failed) throw new Error('A support batch could not be checked; retry the reading');
  throw new BackgroundJobHeldError(new Date(Date.now() + 5_000), 'Support coverage is being checked');
}

/**
 * HASH INPUT PINNED (support-batch-key.test.ts holds it to a value computed
 * on origin/dev before rooms retired). Keys were hashed over
 * {policy, owner, destination, ...payload} with `membershipId: null` between
 * materialHash and statements; destination was the owner for every personal
 * batch. Reproducing that exact JSON keeps existing keys, so a failed batch is
 * still found and a finished one is not bought again.
 */
export function supportBatchKey(ownerProfileId: string, payload: AssessSignalSupportPayload): string {
  const { inspirationId, signalIds, materialRevision, materialHash, statements } = payload;
  return `assess_signal_support:${hashEmbeddingInput(JSON.stringify({ policy: SIGNAL_SUPPORT_REVIEW_POLICY,
    owner: ownerProfileId, destination: ownerProfileId, inspirationId, signalIds, materialRevision, materialHash,
    membershipId: null, statements }))}`;
}

export async function supportBatchInputsCurrent(db: Database, ownerProfileId: string, payload: AssessSignalSupportPayload) {
  const claims = await loadSupportClaims(db, ownerProfileId, ownerProfileId, payload.inspirationId);
  if (payload.signalIds.some((id) => !claims.some((claim) => claim.signalId === id))) return false;
  const report = await reviewSignalSupport(db, { ownerProfileId, inspirationId: payload.inspirationId,
    maxCalls: 0, signalIds: payload.signalIds,
    provider: { assessSignalSupport: async () => { throw new Error('Input verification makes no model call'); } },
  });
  if (report.status !== 'current' || report.material.revision !== payload.materialRevision || report.material.hash !== payload.materialHash) return false;
  return payload.statements.length === payload.signalIds.length && payload.statements.every((statement) =>
    claims.some((claim) => claim.signalId === statement.id && claim.statementRevision === statement.revision && hashEmbeddingInput(claim.statement) === statement.hash));
}
