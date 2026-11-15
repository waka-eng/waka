/** SQL-only explicit recovery. Never called by polling/background retries.
 * A new work version retains every paid attempt; unknown dispatch is a hold. */
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EmbeddingIndexError} from './embedding-index-coordination.js';
type Db=PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
/** The caller holds shared index fence, owned source and generation locks.
 * Only a definite HTTP failure on the CURRENT version can renew that version.
 * The first renewal removes its own eligibility, so repeated human clicks
 * cannot reset an unattempted version's budget indefinitely. */
export async function renewKnownFailedEmbeddingWork(tx:Tx,input:{profileId:string;kind:'inspiration'|'signal';sourceId:string;expectedVersion?:bigint}){
 const [policy]=await tx.execute<{active_space:string;active_epoch:string}>(sql`SELECT active_space,active_epoch::text FROM profile_embedding_indexes WHERE profile_id=${input.profileId}::uuid`);
 if(policy?.active_space!==EMBEDDING_2_SPACE.id)return {renewed:0};
 const work=await tx.execute<{id:string;requested_version:string;input_scope:'personal'|'public'|'statement'}>(sql`SELECT id,requested_version::text,input_scope FROM embedding_index_work WHERE profile_id=${input.profileId}::uuid AND source_kind=${input.kind} AND source_id=${input.sourceId}::uuid AND space=${policy.active_space} ORDER BY input_scope FOR UPDATE NOWAIT`);
 if(input.expectedVersion!==undefined&&(work.length!==1||BigInt(work[0]!.requested_version)!==input.expectedVersion))throw new EmbeddingIndexError('stale');
 // All scopes/families for this source are checked before ANY renewal. A
 // failed canonical request must not bypass an unknown discovery request.
 const [unresolved]=await tx.execute(sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${input.profileId}::uuid AND space=${policy.active_space} AND source_kind=${input.kind} AND source_id=${input.sourceId}::uuid AND status IN ('reserved','received','unknown') LIMIT 1`);
 if(unresolved)throw new EmbeddingIndexError('outcome_unknown');
 let renewed=0;
 for(const cell of work){
  const suffix=':'+cell.id+':'+cell.requested_version+':'+policy.active_epoch+':%';
  const [failed]=await tx.execute(sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${input.profileId}::uuid AND space=${policy.active_space} AND source_kind=${input.kind} AND source_id=${input.sourceId}::uuid AND input_scope=${cell.input_scope} AND dispatch_family='index' AND status='http_failed' AND request_key LIKE ${'index:%'+suffix} LIMIT 1`);
  if(!failed)continue;
  await tx.execute(sql`SELECT embedding_index_request(${input.profileId}::uuid,${input.kind},${input.sourceId}::uuid,${cell.input_scope})`);renewed++;
 }
 return {renewed};
}
/** Privileged metadata helper, not a public route or client tool. Exact work
 * version/epoch/account are required. It creates ordinary metered queue intent,
 * makes no HTTP call, and does not authorize any future paid operator use. */
export async function renewKnownFailedSignalEmbedding(db:Db,input:{accountId:string;profileId:string;signalId:string;expectedVersion:bigint;expectedEpoch:bigint}){
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT embedding_index_shared_fence(${input.profileId}::uuid)`);
  const [owner]=await tx.execute(sql`SELECT id FROM profiles WHERE id=${input.profileId}::uuid AND account_id=${input.accountId}::uuid FOR KEY SHARE NOWAIT`);if(!owner)throw new EmbeddingIndexError('identity');
  const [source]=await tx.execute(sql`SELECT id FROM signals WHERE profile_id=${input.profileId}::uuid AND id=${input.signalId}::uuid FOR UPDATE NOWAIT`);if(!source)throw new EmbeddingIndexError('missing');
  await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=${input.profileId}::uuid FOR UPDATE NOWAIT`);
  const [policy]=await tx.execute<{epoch:string}>(sql`SELECT active_epoch::text AS epoch FROM profile_embedding_indexes WHERE profile_id=${input.profileId}::uuid`);if(!policy||BigInt(policy.epoch)!==input.expectedEpoch)throw new EmbeddingIndexError('stale');
  return renewKnownFailedEmbeddingWork(tx,{profileId:input.profileId,kind:'signal',sourceId:input.signalId,expectedVersion:input.expectedVersion});
 },{isolationLevel:'read committed'});
 // No imported queue/local autodrain here. The approved operator must wake
 // its independently attested worker only after this commit is confirmed.
 return result;
}
