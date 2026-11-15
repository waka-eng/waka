/** Coordination only: no provider, raw source text or vector transport here.
 * Source proofs and SQL-only writes are explicit callbacks; caller retains a
 * returned provider vector across bounded DB-only commit/reconcile attempts. */
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {type EmbeddingIndexPolicy} from './embedding-policy.js';

type Db=PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader=Pick<Db,'execute'>;
export class EmbeddingIndexError extends Error{
 constructor(readonly code:'busy'|'stale'|'missing'|'identity'|'budget'|'calibration_held'|'outcome_unknown'){
  super(`Embedding index ${code}`);this.name='EmbeddingIndexError';
 }
}
function assertSpace(space:string){if(!['gemini-embedding-001',EMBEDDING_2_SPACE.id].includes(space))throw new EmbeddingIndexError('identity');}
export async function readEmbeddingIndexPolicy(db:Reader,profileId:string):Promise<EmbeddingIndexPolicy>{
 const [row]=await db.execute<{active_space:string;active_epoch:string;active_threshold_policy:string;building_space:string|null}>(sql`SELECT active_space,active_epoch::text,active_threshold_policy,building_space FROM profile_embedding_indexes WHERE profile_id=${profileId}::uuid`);
 if(!row)return {profileId,activeSpace:'gemini-embedding-001',activeEpoch:0n,activeThresholdPolicy:'gemini-embedding-001.thresholds.v1',buildingSpace:null};
 assertSpace(row.active_space);if(row.building_space)assertSpace(row.building_space);
 return {profileId,activeSpace:row.active_space,activeEpoch:BigInt(row.active_epoch),activeThresholdPolicy:row.active_threshold_policy,buildingSpace:row.building_space};
}
/** Operator/coordination read. Runtime readers will project policy/pending on
 * their existing owner/vector SQL, not call this as an extra per-reader query. */
export async function readEmbeddingIndexProgress(db:Reader,profileId:string,space:string){
 assertSpace(space);
 const [row]=await db.execute<{pending:boolean;latest:string|null}>(sql`SELECT
  EXISTS(SELECT 1 FROM embedding_index_work WHERE profile_id=${profileId}::uuid AND space=${space} AND requested_version>completed_version) AS pending,
  (SELECT w.requested_version::text FROM embedding_index_work w WHERE w.profile_id=${profileId}::uuid AND w.space=${space} ORDER BY w.requested_version DESC NULLS LAST LIMIT 1) AS latest`);
 const latest=BigInt(row.latest??'0');return {pending:row.pending,latestVersion:latest,coveredVersion:row.pending?null:latest};
}
export async function hasPendingEmbeddingWork(db:Reader,input:{profileId:string;space:string;kind:'inspiration'|'signal';scope:'personal'|'public'|'statement'}){
 assertSpace(input.space);const [row]=await db.execute<{pending:boolean}>(sql`SELECT EXISTS(SELECT 1 FROM embedding_index_work WHERE profile_id=${input.profileId}::uuid AND space=${input.space} AND source_kind=${input.kind} AND input_scope=${input.scope} AND requested_version>completed_version) AS pending`);return row.pending;
}

export interface SettleEmbeddingWork {
 profileId:string;workId:string;version:bigint;space:string;activeEpoch:bigint;
 inputHash:string|null;outcome:'current'|'ineligible';
}
export interface EmbeddingWorkCommit {
 /** Acquire current parent/child/generation proof with NOWAIT; no HTTP. */
 prove:(tx:Tx)=>Promise<void>;
 /** Queue fence last, after work lock; no blocking/HTTP. */
 claim?:(tx:Tx)=>Promise<void>;
 /** Actual current vector/source/space proof, not a prior progress receipt. */
 current?:(tx:Tx)=>Promise<boolean>;
 /** Upsert only the proven space vector. No HTTP or source mutation. */
 write:(tx:Tx)=>Promise<void>;
}
export async function settleEmbeddingIndexWork(tx:Tx,input:SettleEmbeddingWork,commit:EmbeddingWorkCommit){
 assertSpace(input.space);if(input.outcome==='current'&&!/^[a-f0-9]{64}$/.test(input.inputHash??''))throw new EmbeddingIndexError('identity');
 await tx.execute(sql`SELECT embedding_index_shared_fence(${input.profileId}::uuid)`);
 await commit.prove(tx);
 const [work]=await tx.execute<{requested_version:string;completed_version:string;space:string;active_epoch:string;active_space:string;building_space:string|null}>(sql`SELECT w.requested_version::text,w.completed_version::text,w.space,p.active_epoch::text,p.active_space,p.building_space
  FROM embedding_index_work w JOIN profile_embedding_indexes p ON p.profile_id=w.profile_id
  WHERE w.id=${input.workId}::uuid AND w.profile_id=${input.profileId}::uuid FOR UPDATE OF w NOWAIT`);
 if(!work)throw new EmbeddingIndexError('missing');
 if(work.space!==input.space||BigInt(work.requested_version)!==input.version||BigInt(work.active_epoch)!==input.activeEpoch||(work.active_space!==input.space&&work.building_space!==input.space))throw new EmbeddingIndexError('stale');
 await commit.claim?.(tx);
 if(BigInt(work.completed_version)>=input.version&&(!commit.current||await commit.current(tx)))return {status:'already_current' as const};
 await commit.write(tx);
 const rows=await tx.execute(sql`UPDATE embedding_index_work SET completed_version=${input.version.toString()}::bigint,completed_input_hash=${input.inputHash},outcome=${input.outcome},failure_code=NULL,updated_at=clock_timestamp()
  WHERE id=${input.workId}::uuid AND profile_id=${input.profileId}::uuid AND requested_version=${input.version.toString()}::bigint RETURNING id`);
 if(rows.length!==1)throw new EmbeddingIndexError('stale');return {status:'settled' as const};
}
const aborted=(error:unknown)=>{
 let current=error;
 for(let depth=0;depth<4&&current!==null&&typeof current==='object';depth++){
  if(['55P03','40001','40P01'].includes(String((current as {code?:unknown}).code)))return true;
  current=(current as {cause?:unknown}).cause;
 }
 return false;
};
export async function commitEmbeddingIndexResult(db:Db,input:SettleEmbeddingWork,commit:EmbeddingWorkCommit,options:{
 /** Read-only exact vector/progress/source/epoch reconciliation; no provider. */
 reconcile:(db:Db)=>Promise<boolean>;
 onRetry?:(attempt:number)=>Promise<void>;
}){
 for(let attempt=0;attempt<2;attempt++){
  try{return await db.transaction(tx=>settleEmbeddingIndexWork(tx,input,commit));}
  catch(error){
   if(error instanceof EmbeddingIndexError)throw error;
   if(aborted(error)){if(attempt===0){await options.onRetry?.(1);continue;}throw new EmbeddingIndexError('busy');}
   let confirmed=false;try{confirmed=await options.reconcile(db);}catch{/* Unknown is not rollback proof. */}
   if(confirmed)return {status:'reconciled' as const};throw new EmbeddingIndexError('outcome_unknown');
  }
 }
 throw new EmbeddingIndexError('busy');
}

export async function reserveEmbeddingIndexAttempt(db:Db,input:{accountId:string;profileId:string;requestKey:string;family:'index'|'discovery';space:string;activeEpoch:bigint;workId?:string;workVersion?:bigint;kind:'inspiration'|'signal'|'review_answer';sourceId:string;scope:'personal'|'public'|'statement';inputHash:string;inputBytes:number;manifestHash?:string;maxRequests?:number;maxInputBytes?:number},checks?:{prove:(tx:Tx)=>Promise<void>;claim?:(tx:Tx)=>Promise<void>;
 /** Only results retained by this invocation may admit its next group member.
  * Never an API field or a persisted progress/attempt receipt used as a cache. */
 retainedReceivedIds?:string[]}){
 assertSpace(input.space);if(!['index','discovery'].includes(input.family))throw new EmbeddingIndexError('identity');if(!/^[a-f0-9]{64}$/.test(input.inputHash)||!Number.isSafeInteger(input.inputBytes)||input.inputBytes<0||!input.requestKey||input.requestKey.length>256||input.manifestHash&&!/^[a-f0-9]{64}$/.test(input.manifestHash))throw new EmbeddingIndexError('identity');
 if(input.kind==='review_answer'&&(input.family!=='discovery'||!checks?.prove||!checks.claim||input.scope!=='statement'||input.manifestHash||input.workId))throw new EmbeddingIndexError('identity');
 if(input.space===EMBEDDING_2_SPACE.id&&input.kind!=='review_answer'&&(!input.workId||typeof input.workVersion!=='bigint'||input.workVersion<=0n))throw new EmbeddingIndexError('identity');
 if(input.manifestHash&&(!Number.isSafeInteger(input.maxRequests)||input.maxRequests!<=0||!Number.isSafeInteger(input.maxInputBytes)||input.maxInputBytes!<input.inputBytes))throw new EmbeddingIndexError('budget');
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.manifestHash?'waka.embedding-manifest:'+input.manifestHash:'waka.embedding-attempt:'+input.accountId+':'+input.requestKey},0))`);
  const [owner]=await tx.execute(sql`SELECT id FROM profiles WHERE id=${input.profileId}::uuid AND account_id=${input.accountId}::uuid`);if(!owner)throw new EmbeddingIndexError('identity');
  const [prior]=await tx.execute<{id:string;status:string;profile_id:string;space:string;source_kind:string;source_id:string;input_scope:string;input_hash:string;input_bytes:number;manifest_hash:string|null;dispatch_family:string;fresh:boolean;inflight_until:string}>(sql`SELECT *,started_at>clock_timestamp()-interval '30 seconds' AS fresh,(started_at+interval '30 seconds')::text AS inflight_until FROM embedding_index_attempts WHERE account_id=${input.accountId}::uuid AND request_key=${input.requestKey}`);
  if(prior){if(prior.dispatch_family!==input.family||prior.profile_id!==input.profileId||prior.space!==input.space||prior.source_kind!==input.kind||prior.source_id!==input.sourceId||prior.input_scope!==input.scope||prior.input_hash!==input.inputHash||prior.input_bytes!==input.inputBytes||prior.manifest_hash!==(input.manifestHash??null))throw new EmbeddingIndexError('identity');return {id:prior.id,reserved:false,status:prior.status,fresh:prior.fresh,inflightUntil:prior.inflight_until};}
  await tx.execute(sql`SELECT embedding_index_shared_fence(${input.profileId}::uuid)`);
  await checks?.prove(tx);
  const policy=await readEmbeddingIndexPolicy(tx as Reader,input.profileId);
  if(policy.activeEpoch!==input.activeEpoch)throw new EmbeddingIndexError('stale');
  if(input.manifestHash?policy.activeSpace!==input.space&&policy.buildingSpace!==input.space:policy.activeSpace!==input.space)throw new EmbeddingIndexError('identity');
  const owned=input.kind==='inspiration'
   ?await tx.execute(sql`SELECT id FROM inspirations WHERE id=${input.sourceId}::uuid AND profile_id=${input.profileId}::uuid`)
   :input.kind==='review_answer'?await tx.execute(sql`SELECT id FROM review_answers WHERE id=${input.sourceId}::uuid AND profile_id=${input.profileId}::uuid AND deleted_at IS NULL`):await tx.execute(sql`SELECT id FROM signals WHERE id=${input.sourceId}::uuid AND profile_id=${input.profileId}::uuid`);
  if(owned.length!==1)throw new EmbeddingIndexError('identity');
  if(input.workId){const [work]=await tx.execute<{requested_version:string}>(sql`SELECT requested_version::text FROM embedding_index_work WHERE id=${input.workId}::uuid AND profile_id=${input.profileId}::uuid AND space=${input.space} AND source_kind=${input.kind} AND source_id=${input.sourceId}::uuid AND input_scope=${input.scope} FOR UPDATE NOWAIT`);if(!work||BigInt(work.requested_version)!==input.workVersion)throw new EmbeddingIndexError('stale');}
  // Recheck AFTER the source/work lock, in this READ COMMITTED reservation.
  // Different manifest/request advisory keys do not serialize one source.
  // This read closes the outer-read-empty race without holding a lock over HTTP.
  if(input.workId||input.kind==='review_answer'){
   const retained=checks?.retainedReceivedIds??[];
   if(retained.length>12||retained.length&&(input.family!=='discovery'||!/^discovery:[a-f0-9]{64}:\d+:\d+$/.test(input.requestKey)))throw new EmbeddingIndexError('identity');
   const sameGroup=input.requestKey.split(':').slice(0,2).join(':')+':%';
   const retainedClause=retained.length?sql`AND NOT (status='received' AND request_key LIKE ${sameGroup} AND id IN (${sql.join(retained.map(id=>sql`${id}::uuid`),sql`, `)}))`:sql``;
   const [other]=await tx.execute<{id:string;status:string;fresh:boolean;inflight_until:string}>(sql`SELECT id,status,started_at>clock_timestamp()-interval '30 seconds' AS fresh,(started_at+interval '30 seconds')::text AS inflight_until FROM embedding_index_attempts WHERE account_id=${input.accountId}::uuid AND profile_id=${input.profileId}::uuid AND space=${input.space} AND source_kind=${input.kind} AND source_id=${input.sourceId}::uuid AND input_scope=${input.scope} AND dispatch_family=${input.family} AND status IN ('reserved','received','unknown') ${retainedClause} ORDER BY started_at,id LIMIT 1`);
   if(other)return {id:other.id,reserved:false,status:other.status,fresh:other.fresh,inflightUntil:other.inflight_until};
  }
  if(input.manifestHash){const [usage]=await tx.execute<{calls:number;bytes:string}>(sql`SELECT count(*)::int AS calls,coalesce(sum(input_bytes),0)::text AS bytes FROM embedding_index_attempts WHERE manifest_hash=${input.manifestHash}`);if(usage.calls>=input.maxRequests!||BigInt(usage.bytes)+BigInt(input.inputBytes)>BigInt(input.maxInputBytes!))throw new EmbeddingIndexError('budget');}
  await checks?.claim?.(tx);
  const [row]=await tx.execute<{id:string;status:string}>(sql`INSERT INTO embedding_index_attempts(account_id,profile_id,request_key,dispatch_family,purpose,manifest_hash,space,source_kind,source_id,input_scope,input_hash,input_bytes)
   VALUES(${input.accountId}::uuid,${input.profileId}::uuid,${input.requestKey},${input.family},${input.manifestHash?'migration':'live'},${input.manifestHash??null},${input.space},${input.kind},${input.sourceId}::uuid,${input.scope},${input.inputHash},${input.inputBytes}) RETURNING id,status`);
  return {id:row.id,reserved:true,status:row.status};
 },{isolationLevel:'read committed'});
}

/** Deliberately no accepted model2 threshold policy until reviewed calibration.
 * The injected checker is an explicit privileged operator/test dependency,
 * never a client-provided request body or runtime env escape hatch. */
export async function activateEmbeddingIndex(db:Db,input:{profiles:Array<{id:string;epoch:bigint}>;space:string;thresholdPolicy:string},proof:{
 assertThresholdPolicy?:(space:string,policy:string)=>void;
 coverage:(tx:Tx,profileId:string)=>Promise<{complete:boolean;maxVersion:bigint}>;
}){
 assertSpace(input.space);const ids=input.profiles.map(row=>row.id).sort();if(!ids.length||ids.length>32||new Set(ids).size!==ids.length)throw new EmbeddingIndexError('identity');
 const checker=proof.assertThresholdPolicy??((space,policy)=>{if(space!=='gemini-embedding-001'||policy!=='gemini-embedding-001.thresholds.v1')throw new EmbeddingIndexError('calibration_held');});checker(input.space,input.thresholdPolicy);
 const idArray=sql`ARRAY[${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)}]`;
 return db.transaction(async tx=>{
  const fences=await tx.execute<{id:string;locked:boolean}>(sql`WITH owners AS MATERIALIZED (SELECT unnest(${idArray}) AS id ORDER BY id) SELECT id,pg_try_advisory_xact_lock(hashtextextended('waka.embedding-index:'||id::text,0)) AS locked FROM owners`);if(fences.some(row=>!row.locked))throw new EmbeddingIndexError('busy');
  const generations=await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=ANY(${idArray}) ORDER BY profile_id FOR UPDATE NOWAIT`);if(generations.length!==ids.length)throw new EmbeddingIndexError('missing');
  const policies=await tx.execute<{profile_id:string;active_epoch:string;building_space:string|null}>(sql`SELECT profile_id,active_epoch::text,building_space FROM profile_embedding_indexes WHERE profile_id=ANY(${idArray}) ORDER BY profile_id FOR UPDATE NOWAIT`);if(policies.length!==ids.length)throw new EmbeddingIndexError('missing');
  for(const row of policies){if(BigInt(row.active_epoch)!==input.profiles.find(p=>p.id===row.profile_id)!.epoch||row.building_space!==input.space)throw new EmbeddingIndexError('stale');
   const coverage=await proof.coverage(tx,row.profile_id);if(!coverage.complete)throw new EmbeddingIndexError('stale');
   const pending=await readEmbeddingIndexProgress(tx as Reader,row.profile_id,input.space);if(pending.pending||pending.latestVersion!==coverage.maxVersion)throw new EmbeddingIndexError('stale');
   await tx.execute(sql`UPDATE profile_embedding_indexes SET active_space=${input.space},active_epoch=active_epoch+1,active_threshold_policy=${input.thresholdPolicy},building_space=NULL,building_threshold_policy=NULL,cutover_covered_version=${coverage.maxVersion.toString()}::bigint,updated_at=clock_timestamp() WHERE profile_id=${row.profile_id}::uuid`);
  }
  await tx.execute(sql`SELECT advance_generation_revisions(${idArray})`);return {activated:true as const,profiles:ids.length};
 });
}
