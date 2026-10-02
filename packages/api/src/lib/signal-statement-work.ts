/** Statement maintenance is persisted with the wording, before a worker wakes.
 * Current and previously withdrawn owned witnesses both need reassessment. */
import { sql } from 'drizzle-orm';
import type { getDb } from './db.js';
import { enqueueSignalSupportReview, enqueueSignalReembed, enqueueTopOfMindRefresh } from './queue.js';
import { dropSignalEmbedding } from './signal-embeddings.js';
import { acquireSignalDerivationLock } from './signal-match-or-mint.js';

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Lock parents before the statement, matching source mutation/support order.
 * Yield to a source writer rather than wait back on its generation revision. */
export async function lockSignalStatementSources(tx: Transaction, profileId: string, signalId: string) {
  await acquireSignalDerivationLock(tx, profileId);
  const rows = await tx.execute<{ id: string }>(sql`SELECT i.id FROM inspirations i
    WHERE i.profile_id = ${profileId}::uuid AND (
      EXISTS (SELECT 1 FROM signal_evidence e WHERE e.signal_id = ${signalId}::uuid
        AND e.profile_id = ${profileId}::uuid AND e.owner_profile_id = i.profile_id AND e.inspiration_id = i.id)
      OR EXISTS (SELECT 1 FROM signal_support_reviews r WHERE r.signal_id = ${signalId}::uuid
        AND r.profile_id = ${profileId}::uuid AND r.owner_profile_id = i.profile_id AND r.inspiration_id = i.id)
    ) ORDER BY i.id FOR UPDATE NOWAIT`);
  return rows.map((row) => row.id);
}

export async function requestSignalStatementWork(tx: Transaction, input: {
  profileId: string; signalId: string; inspirationIds: string[];
}) {
  await dropSignalEmbedding(tx, { profileId: input.profileId, signalId: input.signalId });
  await enqueueSignalReembed(input.profileId, input.signalId, tx);
  for (const inspirationId of input.inspirationIds) {
    await enqueueSignalSupportReview(input.profileId, inspirationId, tx);
  }
  await enqueueTopOfMindRefresh(input.profileId, 'signals_changed', tx);
}

/** New machine wording validates its immediate sources, but cannot silently
 * renew the statement's other witnesses. Review only currently allowed ones. */
export async function requestRemainingSignalSupportReviews(tx: Transaction, input: {
  profileId: string; signalId: string; verifiedInspirationIds: string[];
}) {
  const sources = await tx.execute<{ id: string; ownerProfileId: string }>(sql`
    SELECT i.id, i.profile_id AS "ownerProfileId" FROM inspirations i WHERE (
      EXISTS (SELECT 1 FROM signal_evidence e WHERE e.profile_id = ${input.profileId}::uuid
        AND e.signal_id = ${input.signalId}::uuid AND e.owner_profile_id = i.profile_id AND e.inspiration_id = i.id)
      OR EXISTS (SELECT 1 FROM signal_support_reviews r WHERE r.profile_id = ${input.profileId}::uuid
        AND r.signal_id = ${input.signalId}::uuid AND r.owner_profile_id = i.profile_id AND r.inspiration_id = i.id)
    ) AND (i.profile_id = ${input.profileId}::uuid OR (i.visibility::text = 'public' AND EXISTS (
      SELECT 1 FROM profiles p JOIN group_members m ON m.group_id = p.group_id
      WHERE p.id = ${input.profileId}::uuid AND p.type::text = 'group' AND m.profile_id = i.profile_id
    ))) ORDER BY i.profile_id, i.id FOR KEY SHARE NOWAIT`);
  const verified = new Set(input.verifiedInspirationIds);
  for (const source of sources) {
    if (verified.has(source.id)) continue;
    await enqueueSignalSupportReview(source.ownerProfileId, source.id, tx,
      source.ownerProfileId === input.profileId ? undefined : input.profileId);
  }
}
