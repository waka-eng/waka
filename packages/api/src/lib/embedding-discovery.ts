/** Durable identity for generated candidate dispatch, not a vector cache.
 * A retry cannot evade an uncertain dispatch by generating different words. */
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {embeddingInputHash,embeddingInSpace,readableEmbeddingSpace} from './embedding-provider.js';
import {embeddingPolicyIdentity,type EmbeddingIndexPolicy} from './embedding-policy.js';
import {reserveEmbeddingIndexAttempt,EmbeddingIndexError} from './embedding-index-coordination.js';
import {EmbeddingIndexNeedsRetry} from './embedding-indexer.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';
import {OpenRouterHttpError} from './openrouter-http.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import type {StatementEmbeddingClient} from './signal-embeddings.js';
type Db=PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
export interface DiscoveryEmbeddingInput{
 profileId:string;sourceKind:'inspiration'|'review_answer';sourceId:string;
 materialHash:string;request:{jobId:string;requestVersion:string};policy:EmbeddingIndexPolicy;
 statements:string[];
 /** Required actual source lineage/generation/policy proof and live claim. */
 prove:(tx:Tx)=>Promise<void>;claim:(tx:Tx)=>Promise<void>;
}
export async function embedDiscoveryCandidates(db:Db,input:DiscoveryEmbeddingInput,client:StatementEmbeddingClient){
 if(client.model!==EMBEDDING_2_SPACE.id||readableEmbeddingSpace(input.policy)?.model!==client.model||input.policy.profileId!==input.profileId||!input.statements.length||input.statements.length>12||input.statements.some(text=>!text||Buffer.byteLength(text)>2000)||!/^[a-f0-9]{64}$/.test(input.materialHash)||!/^\d+$/.test(input.request.requestVersion))throw new EmbeddingIndexError('identity');
 const group=hashEmbeddingInput(JSON.stringify({sourceKind:input.sourceKind,sourceId:input.sourceId,materialHash:input.materialHash,request:input.request,policy:embeddingPolicyIdentity(input.policy)}));
 const base='discovery:'+group;
 const prior=await db.execute<{request_key:string;input_hash:string;status:string;http_status:number|null;fresh:boolean;inflight_until:string}>(sql`SELECT request_key,input_hash,status,http_status,started_at>clock_timestamp()-interval '30 seconds' AS fresh,(started_at+interval '30 seconds')::text AS inflight_until FROM embedding_index_attempts WHERE profile_id=${input.profileId}::uuid AND request_key LIKE ${base+':%'} ORDER BY request_key`);
 // Inspect the WHOLE prior group before any new HTTP. New text/order/member
 // count cannot step around a reserved/received/unknown older member.
 for(const row of prior){
  const suffix=row.request_key.slice(base.length+1).split(':'),member=Number(suffix[0]);
  if(suffix.length!==2||!Number.isInteger(member)||member<0||member>=input.statements.length||row.input_hash!==embeddingInputHash(client.model,input.statements[member]!))throw new EmbeddingIndexNeedsRetry('outcome_unknown');
  if(['reserved','received'].includes(row.status)&&row.fresh)throw new BackgroundJobHeldError(new Date(row.inflight_until),'Discovery embedding is still in flight');
  if(row.status==='reserved'||row.status==='unknown')throw new EmbeddingIndexNeedsRetry('outcome_unknown');
  if(row.status==='received'||row.status==='committed')throw new EmbeddingIndexNeedsRetry('commit_unconfirmed');
  if(row.status!=='http_failed'||row.http_status!==429&&(row.http_status===null||row.http_status<500))throw new EmbeddingIndexNeedsRetry('provider_refused');
 }
 const [owner]=await db.execute<{account_id:string}>(sql`SELECT account_id FROM profiles WHERE id=${input.profileId}::uuid`);if(!owner?.account_id)throw new EmbeddingIndexError('identity');
 const results:Array<{embedding:number[];attemptId:string}>=[];
 for(const [member,text] of input.statements.entries()){
  const seen=prior.filter(row=>row.request_key.startsWith(base+':'+member+':'));if(seen.length>=3)throw new EmbeddingIndexNeedsRetry('provider_refused');
  const [work]=input.sourceKind==='inspiration'?await db.execute<{id:string;version:string}>(sql`SELECT id,requested_version::text AS version FROM embedding_index_work WHERE profile_id=${input.profileId}::uuid AND space=${client.model} AND source_kind='inspiration' AND source_id=${input.sourceId}::uuid AND input_scope='personal'`):[];
  if(input.sourceKind==='inspiration'&&!work)throw new EmbeddingIndexError('missing');
  const attempt=await reserveEmbeddingIndexAttempt(db,{accountId:owner.account_id,profileId:input.profileId,requestKey:base+':'+member+':'+(seen.length+1),family:'discovery',space:client.model,activeEpoch:input.policy.activeEpoch,kind:input.sourceKind,sourceId:input.sourceId,scope:input.sourceKind==='inspiration'?'personal':'statement',inputHash:embeddingInputHash(client.model,text),inputBytes:Buffer.byteLength(text)+Buffer.byteLength(EMBEDDING_2_SPACE.documentPrefix),...(work?{workId:work.id,workVersion:BigInt(work.version)}:{})},{prove:input.prove,claim:input.claim,retainedReceivedIds:results.map(row=>row.attemptId)});
  if(!attempt.reserved){if('fresh' in attempt&&attempt.fresh&&['reserved','received'].includes(attempt.status))throw new BackgroundJobHeldError(new Date(attempt.inflightUntil),'Embedding request is still in flight');throw new EmbeddingIndexNeedsRetry(attempt.status==='received'?'commit_unconfirmed':attempt.status==='committed'?'commit_unconfirmed':'outcome_unknown');}
  let embedding:number[];
  try{embedding=await client.embed(text);if(!embeddingInSpace(embedding,768,{model:client.model,dimensions:768}))throw new EmbeddingIndexNeedsRetry('provider_refused');}
  catch(error){const status=error instanceof OpenRouterHttpError?error.status:null;await db.execute(sql`UPDATE embedding_index_attempts SET status=${status===null?'unknown':'http_failed'},http_status=${status},finished_at=clock_timestamp() WHERE id=${attempt.id}::uuid AND account_id=${owner.account_id}::uuid`);if(status===429||status!==null&&status>=500)throw Error('Embedding provider transient HTTP failure');throw new EmbeddingIndexNeedsRetry(status===null?'outcome_unknown':'provider_refused');}
  // An uncertain checkpoint retains the provider result in THIS invocation.
  // Publication either commits it with its decision or requires reconciliation.
  try{await db.execute(sql`UPDATE embedding_index_attempts SET status='received',finished_at=clock_timestamp() WHERE id=${attempt.id}::uuid AND account_id=${owner.account_id}::uuid`);}catch{/* no transport replay */}
  results.push({embedding,attemptId:attempt.id});
 }
 return results;
}
/** Same transaction as the current-material derived decision and receipt.
 * Does not certify a source vector; index reconciliation proves that itself. */
export async function commitDiscoveryEmbeddings(tx:Tx,profileId:string,ids:string[]){
 if(ids.length)await tx.execute(sql`UPDATE embedding_index_attempts SET status='committed',finished_at=clock_timestamp() WHERE profile_id=${profileId}::uuid AND id IN (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)}) AND status IN ('reserved','received')`);
}
