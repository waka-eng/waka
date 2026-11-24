import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EMBEDDING_2_SPACE } from './embedding-2-space.js';
import { EmbeddingIndexError } from './embedding-index-coordination.js';

type Db = PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface LiveEmbeddingCheckpoint {
  workId: string;
  version: bigint;
  epoch: bigint;
  accountId: string;
  profileId: string;
  sourceKind: 'inspiration' | 'signal';
  sourceId: string;
  scope: 'personal' | 'public' | 'statement';
  inputHash: string;
  attemptId: string;
  requestKey: string;
}

const cellIdentity = (c: LiveEmbeddingCheckpoint) => sql`
  w.id=${c.workId}::uuid AND w.profile_id=${c.profileId}::uuid
  AND w.requested_version=${c.version}::bigint AND w.completed_version<w.requested_version
  AND w.space=${EMBEDDING_2_SPACE.id} AND w.source_kind=${c.sourceKind}
  AND w.source_id=${c.sourceId}::uuid AND w.input_scope=${c.scope}`;

const attemptIdentity = (c: LiveEmbeddingCheckpoint) => sql`
  a.id=${c.attemptId}::uuid AND a.account_id=${c.accountId}::uuid
  AND a.profile_id=${c.profileId}::uuid AND a.request_key=${c.requestKey}
  AND a.space=${EMBEDDING_2_SPACE.id} AND a.source_kind=${c.sourceKind}
  AND a.source_id=${c.sourceId}::uuid AND a.input_scope=${c.scope} AND a.input_hash=${c.inputHash}
  AND a.purpose='live' AND a.dispatch_family='index'`;

/** Keep a validated result outside publication's source/generation locks.
 * Source edits, deletion and policy changes discard it under the work lock.
 * Checkpointing is private; publication still requires current material and a live claim. */
export async function stageLiveEmbedding(db: Db, c: LiveEmbeddingCheckpoint, values: number[]) {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout='750ms'`);
    await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
    await tx.execute(sql`SELECT embedding_index_shared_fence(${c.profileId}::uuid)`);
    const [cell] = await tx.execute(sql`
      SELECT w.id FROM embedding_index_work w
      JOIN profile_embedding_indexes p ON p.profile_id=w.profile_id
      JOIN profiles owner ON owner.id=w.profile_id
      WHERE ${cellIdentity(c)} AND p.active_epoch=${c.epoch}::bigint AND p.active_space=w.space
        AND owner.account_id=${c.accountId}::uuid AND w.pending_embedding IS NULL
      FOR UPDATE OF w`);
    if (!cell) {
      // The input changed or disappeared before a known valid result returned.
      // Only retire our own receipt when the exact identity is no longer current.
      await tx.execute(sql`UPDATE embedding_index_attempts a SET status='stale',finished_at=clock_timestamp()
        WHERE ${attemptIdentity(c)} AND a.status='reserved'
        AND NOT EXISTS (SELECT 1 FROM embedding_index_work w JOIN profile_embedding_indexes p ON p.profile_id=w.profile_id
          WHERE ${cellIdentity(c)} AND p.active_epoch=${c.epoch}::bigint AND p.active_space=w.space)`);
      return false;
    }
    const [received] = await tx.execute(sql`UPDATE embedding_index_attempts a
      SET status='received',finished_at=clock_timestamp()
      WHERE ${attemptIdentity(c)} AND a.status='reserved' RETURNING a.id`);
    if (!received) throw new EmbeddingIndexError('outcome_unknown');
    await tx.execute(sql`UPDATE embedding_index_work w
      SET pending_embedding=${JSON.stringify({attemptId:c.attemptId,values})}::jsonb
      WHERE ${cellIdentity(c)}`);
    return true;
  });
}

export async function readLiveEmbeddingCheckpoint(db: Pick<Db, 'execute'>, c: LiveEmbeddingCheckpoint) {
  const [row] = await db.execute<{ values: unknown }>(sql`
    SELECT w.pending_embedding->'values' AS values FROM embedding_index_work w
    JOIN embedding_index_attempts a ON a.id=${c.attemptId}::uuid AND a.id::text=w.pending_embedding->>'attemptId'
    JOIN profile_embedding_indexes p ON p.profile_id=w.profile_id
    JOIN profiles owner ON owner.id=w.profile_id
    WHERE ${cellIdentity(c)} AND ${attemptIdentity(c)} AND a.status='received'
      AND p.active_epoch=${c.epoch}::bigint AND p.active_space=w.space AND owner.account_id=${c.accountId}::uuid`);
  return row?.values;
}

/** The existing publisher has already locked and proved the work and claim. */
export async function finishLiveEmbedding(tx: Tx, c: LiveEmbeddingCheckpoint) {
  const [settled] = await tx.execute(sql`UPDATE embedding_index_attempts a SET status='committed',finished_at=coalesce(a.finished_at,clock_timestamp())
    WHERE ${attemptIdentity(c)} AND a.status IN ('reserved','received','committed')
    AND EXISTS (SELECT 1 FROM profiles owner WHERE owner.id=a.profile_id AND owner.account_id=a.account_id)
    RETURNING a.id`);
  if (!settled) throw new EmbeddingIndexError('outcome_unknown');
  await tx.execute(sql`UPDATE embedding_index_work w SET pending_embedding=NULL
    WHERE ${cellIdentity(c)} AND w.pending_embedding->>'attemptId'=${c.attemptId}`);
}
