/** One owned source/work version, one provider result, SQL-only publication.
 * Queue and capped operator share this path. No raw text/vector is logged. */
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {createEmbeddingClient,readableEmbeddingSpace,embeddingInSpace,embeddingInputHash,type EmbeddingSpace} from './embedding-provider.js';
import {parseEmbeddingPolicy,embeddingPolicySql,embeddingPolicyIdentity,type EmbeddingIndexPolicy} from './embedding-policy.js';
import type {GeminiEmbeddingClient} from './inspiration-embeddings.js';
import {readEmbeddingIndexSource} from './embedding-index-source.js';
import {commitEmbeddingIndexResult,reserveEmbeddingIndexAttempt,settleEmbeddingIndexWork,EmbeddingIndexError,type SettleEmbeddingWork} from './embedding-index-coordination.js';
import {OpenRouterHttpError} from './openrouter-http.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import {EmbeddingDispatchExpired,assertEmbeddingDispatchDeadline,type EmbeddingDispatchDeadline} from './embedding-dispatch.js';
import {EmbeddingSourceReadLimit} from './embedding-source-limits.js';
import {databaseSqlState} from './error-diagnostics.js';
import {finishLiveEmbedding,readLiveEmbeddingCheckpoint,stageLiveEmbedding,type LiveEmbeddingCheckpoint} from './embedding-index-checkpoint.js';
import {Embedding2ResponseError,type Embedding2ResponseFailure} from './embedding-2-response.js';
type Db=PostgresJsDatabase<typeof import('../db/index.js')>;type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
export const EMBEDDING_INDEX_LIMITS={sourceBytes:48000,perJob:1,commitAttempts:2,normalHttpAttempts:3} as const;
export class EmbeddingIndexNeedsRetry extends Error{
 constructor(readonly code:'outcome_unknown'|'provider_refused'|'input_too_large'|'commit_unconfirmed'|'current_vector_unavailable'|'publication_pending',readonly responseFailure?:Embedding2ResponseFailure,options?:ErrorOptions){super(`Embedding index needs explicit recovery: ${code}${responseFailure?':'+responseFailure:''}`,options);this.name='EmbeddingIndexNeedsRetry';}
}
type Kind='inspiration'|'signal';type Scope='personal'|'public'|'statement';
type Work={id:string;profile_id:string;source_kind:Kind;source_id:string;input_scope:Scope;space:string;requested_version:string;account_id:string;policy:unknown};
type Source={input:string;eligible:boolean};
export interface IndexSourceInput{profileId:string;sourceKind:Kind;sourceId:string;space:string;scope?:Scope}
export interface IndexSourceDependencies{
 client?:GeminiEmbeddingClient;expectedPolicy?:EmbeddingIndexPolicy;
 /** Existing queue claim fence; called last in short SQL-only transactions. */
 beforeCommit?:(tx:Tx)=>Promise<void>;
 migration?:{manifestHash:string;maxRequests:number;maxInputBytes:number};
 dispatchDeadline?:EmbeddingDispatchDeadline;
}
const space:EmbeddingSpace={model:EMBEDDING_2_SPACE.id,dimensions:EMBEDDING_2_SPACE.dimensions};
async function source(db:Db|Tx,work:Work,lock=false):Promise<Source>{
 try{return await readEmbeddingIndexSource(db as Db,work,lock);}
 catch(error){if(error instanceof EmbeddingSourceReadLimit)throw new EmbeddingIndexNeedsRetry('input_too_large');throw error;}
}
async function generation(tx:Tx,profileId:string){await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=${profileId}::uuid FOR UPDATE NOWAIT`);}
async function vector(db:Db|Tx,work:Work,hash:string|null,lock=false){
 const rows=work.source_kind==='inspiration'
  ?await db.execute<{embedding:unknown;dimensions:number;input_hash:string}>(sql`SELECT embedding,dimensions,input_hash FROM inspiration_embeddings WHERE profile_id=${work.profile_id}::uuid AND inspiration_id=${work.source_id}::uuid AND model=${work.space} AND input_scope=${work.input_scope} ${lock?sql`FOR SHARE NOWAIT`:sql``}`)
  :await db.execute<{embedding:unknown;dimensions:number;input_hash:string}>(sql`SELECT embedding,dimensions,input_hash FROM signal_embeddings WHERE profile_id=${work.profile_id}::uuid AND signal_id=${work.source_id}::uuid AND model=${work.space} ${lock?sql`FOR SHARE NOWAIT`:sql``}`);
 return hash!==null&&rows[0]?.input_hash===hash&&embeddingInSpace(rows[0].embedding,rows[0].dimensions,space)?rows[0].embedding:null;
}
async function vectorPresent(db:Db|Tx,work:Work){
 const rows=work.source_kind==='inspiration'
  ?await db.execute(sql`SELECT id FROM inspiration_embeddings WHERE profile_id=${work.profile_id}::uuid AND inspiration_id=${work.source_id}::uuid AND model=${work.space} AND input_scope=${work.input_scope}`)
  :await db.execute(sql`SELECT id FROM signal_embeddings WHERE profile_id=${work.profile_id}::uuid AND signal_id=${work.source_id}::uuid AND model=${work.space}`);
 return rows.length>0;
}
async function writeVector(tx:Tx,work:Work,hash:string|null,values:number[]|null){
 if(!values||hash===null){
  if(work.source_kind==='inspiration')await tx.execute(sql`DELETE FROM inspiration_embeddings WHERE profile_id=${work.profile_id}::uuid AND inspiration_id=${work.source_id}::uuid AND model=${work.space} AND input_scope=${work.input_scope}`);
  else await tx.execute(sql`DELETE FROM signal_embeddings WHERE profile_id=${work.profile_id}::uuid AND signal_id=${work.source_id}::uuid AND model=${work.space}`);
  return;
 }
 if(work.source_kind==='inspiration')await tx.execute(sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding) VALUES(${work.profile_id}::uuid,${work.source_id}::uuid,${work.space},${work.input_scope},768,${hash},${JSON.stringify(values)}::jsonb) ON CONFLICT(inspiration_id,model,input_scope) DO UPDATE SET dimensions=excluded.dimensions,input_hash=excluded.input_hash,embedding=excluded.embedding,updated_at=clock_timestamp()`);
 else await tx.execute(sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding) VALUES(${work.profile_id}::uuid,${work.source_id}::uuid,${work.space},768,${hash},${JSON.stringify(values)}::jsonb) ON CONFLICT(signal_id,model) DO UPDATE SET dimensions=excluded.dimensions,input_hash=excluded.input_hash,embedding=excluded.embedding,updated_at=clock_timestamp()`);
}
export async function indexEmbeddingSource(db:Db,input:IndexSourceInput,deps:IndexSourceDependencies={}){
 if(input.space!==EMBEDDING_2_SPACE.id)throw new EmbeddingIndexError('identity');
 const [work]=await db.execute<Work>(sql`SELECT w.id,w.profile_id,w.source_kind,w.source_id,w.input_scope,w.space,w.requested_version::text,p.account_id,${embeddingPolicySql(input.profileId)} AS policy FROM embedding_index_work w JOIN profiles p ON p.id=w.profile_id WHERE w.profile_id=${input.profileId}::uuid AND w.space=${input.space} AND w.source_kind=${input.sourceKind} AND w.source_id=${input.sourceId}::uuid ${input.scope?sql`AND w.input_scope=${input.scope}`:sql``} ORDER BY (w.requested_version>w.completed_version) DESC,w.input_scope LIMIT 1`);
 if(!work)return {status:'missing' as const,generated:false,embedding:null,inputHash:null};
 const policy=parseEmbeddingPolicy(input.profileId,work.policy),migration=deps.migration;
 if(deps.expectedPolicy&&embeddingPolicyIdentity(policy)!==embeddingPolicyIdentity(deps.expectedPolicy))throw new EmbeddingIndexError('stale');
 if(readableEmbeddingSpace(policy)?.model!==work.space&&!(migration&&policy.activeSpace!==work.space&&policy.buildingSpace===work.space))return {status:'inactive' as const,generated:false,embedding:null,inputHash:null};
 const initial=await source(db,work),hash=initial.eligible?embeddingInputHash(work.space,initial.input):null;
 if(initial.eligible&&Buffer.byteLength(initial.input)>EMBEDDING_INDEX_LIMITS.sourceBytes)throw new EmbeddingIndexNeedsRetry('input_too_large');
 const snapshot:SettleEmbeddingWork={profileId:work.profile_id,workId:work.id,version:BigInt(work.requested_version),space:work.space,activeEpoch:policy.activeEpoch,inputHash:hash,outcome:initial.eligible?'current':'ineligible'};
 const prove=async(tx:Tx)=>{const current=await source(tx,work,true);await generation(tx,work.profile_id);if(current.eligible!==initial.eligible||current.eligible&&embeddingInputHash(work.space,current.input)!==hash)throw new EmbeddingIndexError('stale');};
 const actualCurrent=async(tx:Tx)=>initial.eligible?Boolean(await vector(tx,work,hash,true)):!await vectorPresent(tx,work);
 const reconcile=async(reader:Db)=>reader.transaction(async tx=>{
  const [state]=await tx.execute<{policy:unknown;requested:string;completed:string}>(sql`SELECT ${embeddingPolicySql(work.profile_id)} AS policy,requested_version::text AS requested,completed_version::text AS completed FROM embedding_index_work WHERE id=${work.id}::uuid AND profile_id=${work.profile_id}::uuid`);
  if(!state||embeddingPolicyIdentity(parseEmbeddingPolicy(work.profile_id,state.policy))!==embeddingPolicyIdentity(policy)||BigInt(state.requested)!==snapshot.version||BigInt(state.completed)<snapshot.version)return false;
  const current=await source(tx,work);return current.eligible===initial.eligible&&(current.eligible?embeddingInputHash(work.space,current.input)===hash&&Boolean(await vector(tx,work,hash)):!await vectorPresent(tx,work));
 },{isolationLevel:'repeatable read',accessMode:'read only'});
 const cached=initial.eligible?await vector(db,work,hash):null;
 if(!initial.eligible||cached){await commitEmbeddingIndexResult(db,snapshot,{prove,current:actualCurrent,claim:deps.beforeCommit,write:async tx=>{if(!initial.eligible)await writeVector(tx,work,null,null);else if(!await vector(tx,work,hash,true))throw new EmbeddingIndexError('stale');}}, {reconcile});return{status:initial.eligible?'unchanged' as const:'ineligible' as const,generated:false,embedding:cached,inputHash:hash};}
 // The first vector read preceded the attempt/checkpoint read. A winner
 // may have published in between. Only reuse its completed work and re-read
 // the actual vector under the normal fences. A receipt alone is no proof.
 const reusePublished = async () => {
  // Leave genuinely in-flight work on its existing hold path without
  // taking locks against the publisher.
  if (!await vector(db,work,hash)) return null;
  const unavailable = new EmbeddingIndexNeedsRetry('current_vector_unavailable');
  try {
   return await db.transaction(async tx => {
    let embedding: number[] | null = null;
    await settleEmbeddingIndexWork(tx,snapshot,{
     prove,claim:deps.beforeCommit,
     current:async tx=>{
      const [owner]=await tx.execute<{policy:unknown}>(sql`SELECT ${embeddingPolicySql(work.profile_id)} AS policy FROM profiles
        WHERE id=${work.profile_id}::uuid AND account_id=${work.account_id}::uuid`);
      if(!owner||embeddingPolicyIdentity(parseEmbeddingPolicy(work.profile_id,owner.policy))!==embeddingPolicyIdentity(policy))throw new EmbeddingIndexError('stale');
      embedding=await vector(tx,work,hash,true);
      return embedding!==null;
     },
     write:async()=>{throw unavailable;},
    });
    return {status:'unchanged' as const,generated:false,embedding,inputHash:hash};
   });
  } catch(error) {
   if(error===unavailable)return null;
   throw error;
  }
 };
 const dispatchGuard=()=>{if(deps.dispatchDeadline)assertEmbeddingDispatchDeadline(deps.dispatchDeadline);};
 const client=deps.client??createEmbeddingClient({timeoutMs:5000,exchangeTimeoutMs:10000,beforeDispatch:dispatchGuard},policy,migration&&policy.activeSpace!==work.space?'building':'active');
 if(client.model!==work.space||client.dimensions!==undefined&&client.dimensions!==768)throw new EmbeddingIndexError('identity');
 const base=`index:${migration?.manifestHash??'live'}:${work.id}:${work.requested_version}:${policy.activeEpoch}`;
 const prior=await db.execute<{request_key:string;status:string;http_status:number|null;inflight_until:string;fresh:boolean;id:string}>(sql`SELECT request_key,status,http_status,id,(started_at+interval '30 seconds')::text AS inflight_until,started_at>clock_timestamp()-interval '30 seconds' AS fresh FROM embedding_index_attempts WHERE account_id=${work.account_id}::uuid AND (request_key IN (${base+':1'},${base+':2'},${base+':3'}) OR (profile_id=${work.profile_id}::uuid AND space=${work.space} AND source_kind=${work.source_kind} AND source_id=${work.source_id}::uuid AND input_scope=${work.input_scope} AND dispatch_family='index' AND status IN ('reserved','received','unknown'))) ORDER BY request_key`);
 const checkpoint = (attemptId:string,requestKey:string):LiveEmbeddingCheckpoint => ({
  workId:work.id,version:snapshot.version,epoch:policy.activeEpoch,accountId:work.account_id,profileId:work.profile_id,
  sourceKind:work.source_kind,sourceId:work.source_id,scope:work.input_scope,inputHash:hash!,attemptId,requestKey,
 });
 const publish = async (values:number[],attemptId:string,staged:boolean,live?:LiveEmbeddingCheckpoint) => {
  const finish = (tx:Tx) => live ? finishLiveEmbedding(tx,live) : tx.execute(sql`UPDATE embedding_index_attempts
    SET status='committed',finished_at=clock_timestamp() WHERE id=${attemptId}::uuid AND account_id=${work.account_id}::uuid`);
  try {
   await commitEmbeddingIndexResult(db,snapshot,{
    prove,claim:deps.beforeCommit,
    current:async tx=>{const current=await actualCurrent(tx);if(current)await finish(tx);return current;},
    write:async tx=>{await writeVector(tx,work,hash,values);await finish(tx);},
   },{reconcile});
  } catch(error) {
   if(error instanceof EmbeddingIndexError && error.code==='stale')throw error;
   throw new EmbeddingIndexNeedsRetry(staged?'publication_pending':'commit_unconfirmed',undefined,{cause:error});
  }
 };
 // A current live result can be published by another claim. Other reservations,
 // including discoveries and old receipts without bytes, never authorize replay.
 const unresolved=prior.filter(row=>['reserved','received','unknown'].includes(row.status));
 if(!migration && unresolved.length===1 && unresolved[0]!.status==='received'){
  const received=unresolved[0]!;
  if([base+':1',base+':2',base+':3'].includes(received.request_key)){
   const live=checkpoint(received.id,received.request_key);
   const retained=await readLiveEmbeddingCheckpoint(db,live);
   if(embeddingInSpace(retained,768,space)){
    await publish(retained,received.id,true,live);
    return {status:'updated' as const,generated:false,embedding:retained,inputHash:hash};
   }
   const winner=await reusePublished();
   if(winner)return winner;
  }
 }
 const inflight=prior.find(row=>['reserved','received'].includes(row.status)&&row.fresh);
 if(inflight)throw new BackgroundJobHeldError(new Date(inflight.inflight_until),'Embedding request is still in flight');
 if(prior.some(row=>row.status==='committed')){
  const winner=await reusePublished();
  if(winner)return winner;
  throw new EmbeddingIndexNeedsRetry('current_vector_unavailable');
 }
 if(prior.some(row=>row.status==='received'))throw new EmbeddingIndexNeedsRetry('commit_unconfirmed');
 if(prior.some(row=>row.status==='unknown'||row.status==='reserved'))throw new EmbeddingIndexNeedsRetry('outcome_unknown');
 if(prior.some(row=>row.status!=='http_failed'||row.http_status!==429&&(row.http_status===null||row.http_status<500))||migration&&prior.length||prior.length>=3)throw new EmbeddingIndexNeedsRetry('provider_refused');
 const requestKey=base+':'+(prior.length+1);
 const attempt=await reserveEmbeddingIndexAttempt(db,{accountId:work.account_id,profileId:work.profile_id,requestKey,family:'index',space:work.space,activeEpoch:policy.activeEpoch,workId:work.id,workVersion:snapshot.version,kind:work.source_kind,sourceId:work.source_id,scope:work.input_scope,inputHash:hash!,inputBytes:Buffer.byteLength(initial.input)+Buffer.byteLength(EMBEDDING_2_SPACE.documentPrefix),...(migration??{})},{prove,claim:deps.beforeCommit});
 if(!attempt.reserved){
  if(attempt.status==='committed'||attempt.status==='received'){
   const winner=await reusePublished();
   if(winner)return winner;
  }
  if('fresh' in attempt&&attempt.fresh&&['reserved','received'].includes(attempt.status))throw new BackgroundJobHeldError(new Date(attempt.inflightUntil),'Embedding request is still in flight');
  throw new EmbeddingIndexNeedsRetry(attempt.status==='received'?'commit_unconfirmed':attempt.status==='committed'?'current_vector_unavailable':'outcome_unknown');
 }
 let values:number[];
 try{dispatchGuard();values=await client.embed(initial.input,'RETRIEVAL_DOCUMENT');if(!embeddingInSpace(values,768,space))throw new EmbeddingIndexNeedsRetry('provider_refused');}
 catch(error){if(error instanceof EmbeddingDispatchExpired){await db.execute(sql`UPDATE embedding_index_attempts SET status='stale',finished_at=clock_timestamp() WHERE id=${attempt.id}::uuid AND account_id=${work.account_id}::uuid`);throw new EmbeddingIndexError('budget');}const status=error instanceof OpenRouterHttpError?error.status:null,responseFailure=error instanceof Embedding2ResponseError?error.code:undefined;await db.execute(sql`UPDATE embedding_index_work SET failure_code=${responseFailure?'response_'+responseFailure:status!==null?'provider_http_failure':'outcome_unknown'} WHERE id=${work.id}::uuid AND profile_id=${work.profile_id}::uuid AND requested_version=${work.requested_version}::bigint AND completed_version<requested_version`);await db.execute(sql`UPDATE embedding_index_attempts SET status=${status!==null?'http_failed':'unknown'},http_status=${status},finished_at=clock_timestamp() WHERE id=${attempt.id}::uuid AND account_id=${work.account_id}::uuid`);if(error instanceof OpenRouterHttpError && (error.status===429 || error.status>=500)){
    throw new OpenRouterHttpError('Embedding provider transient HTTP failure',error.status,error.creditRefused);
  }throw new EmbeddingIndexNeedsRetry(responseFailure?'provider_refused':status===null?'outcome_unknown':'provider_refused',responseFailure);}
 // Checkpoint before taking publication's source/generation/queue locks.
 // If checkpointing is unconfirmed the vector is still available for the
 // original SQL-only publication in this invocation. Recheck the checkpoint
 // to distinguish a lost acknowledgement from an unpersisted result.
 let staged=false;
 const live=migration?undefined:checkpoint(attempt.id,requestKey);
 if(live){
  for(let attempt=0;attempt<2;attempt++){
   try{staged=await stageLiveEmbedding(db,live,values);break;}
   catch(error){
    if(attempt===0&&['55P03','40001','40P01'].includes(databaseSqlState(error)??''))continue;
    try{staged=embeddingInSpace(await readLiveEmbeddingCheckpoint(db,live),768,space);}
    catch{/* No durable receipt was proved. */}
    break;
   }
  }
 }else{
  try{await db.execute(sql`UPDATE embedding_index_attempts SET status='received',finished_at=clock_timestamp()
    WHERE id=${attempt.id}::uuid AND account_id=${work.account_id}::uuid`);}
  catch{/* Result remains in this invocation's memory. */}
 }
 await publish(values,attempt.id,staged,live);
 return {status:'updated' as const,generated:true,embedding:values,inputHash:hash};
}
