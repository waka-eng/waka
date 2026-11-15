/** Privileged preparation tools, never an application route. D0 is counts
 * only; D1 reads current memory and may send it to the approved embedding
 * provider. Neither function activates a space or removes native vectors. */
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {NATIVE_EMBEDDING_POLICY} from './embedding-policy.js';
import {EmbeddingIndexError} from './embedding-index-coordination.js';
import {renewKnownFailedSignalEmbedding} from './embedding-index-recovery.js';
import {indexEmbeddingSource,type IndexSourceDependencies} from './embedding-indexer.js';
type Db=PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
const sha=z.string().regex(/^[a-f0-9]{64}$/),epoch=z.string().regex(/^\d+$/);
export const embeddingShadowManifest=z.object({
 version:z.literal('embedding2-shadow-v1'),accountId:z.string().uuid(),
 profiles:z.array(z.object({id:z.string().uuid(),epoch}).strict()).min(1).max(32),
 targetSpace:z.literal(EMBEDDING_2_SPACE.id),approvedDbSha256:sha,
 expiresAt:z.string().datetime(),maxInventoryCells:z.number().int().min(1).max(1000),
 maxCellsPerInvocation:z.number().int().min(1).max(100),
 maxRequests:z.number().int().min(1).max(1000),
 maxFormattedInputBytes:z.number().int().min(1).max(48000000),
 maxDurationMs:z.number().int().min(20000).max(60000),
 /** Operational allowance, not an endpoint invoice or enforced USD cap. */
 operationalAllowanceUsd:z.number().positive().max(10),
 /** Optional exact metadata-only recovery target; never chosen from a scan. */
 signalRecovery:z.object({profileId:z.string().uuid(),signalId:z.string().uuid(),workVersion:epoch}).strict().optional(),
}).strict().superRefine((m,c)=>{if(new Set(m.profiles.map(p=>p.id)).size!==m.profiles.length)c.addIssue({code:'custom',message:'Duplicate profile target'});});
export type EmbeddingShadowManifest=z.infer<typeof embeddingShadowManifest>;
export function embeddingShadowManifestHash(value:EmbeddingShadowManifest){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function manifest(value:unknown,approvedHash:string){const m=embeddingShadowManifest.parse(value);if(embeddingShadowManifestHash(m)!==approvedHash||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=Date.now())throw new EmbeddingIndexError('identity');return m;}
const idsSql=(m:EmbeddingShadowManifest)=>sql`ARRAY[${sql.join(m.profiles.map(p=>sql`${p.id}::uuid`),sql`, `)}]`;
async function targets(tx:Tx,m:EmbeddingShadowManifest){
 const rows=await tx.execute<{id:string;epoch:string;space:string;policy:string;building:string|null;building_policy:string|null}>(sql`SELECT p.id,coalesce(e.active_epoch,0)::text AS epoch,coalesce(e.active_space,'gemini-embedding-001') AS space,coalesce(e.active_threshold_policy,${NATIVE_EMBEDDING_POLICY}::text) AS policy,e.building_space AS building,e.building_threshold_policy AS building_policy FROM profiles p LEFT JOIN profile_embedding_indexes e ON e.profile_id=p.id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${idsSql(m)}) AND p.type IN ('human','agent') ORDER BY p.id`);
 if(rows.length!==m.profiles.length||rows.some(p=>p.epoch!==m.profiles.find(x=>x.id===p.id)!.epoch||p.space!=='gemini-embedding-001'||p.policy!==NATIVE_EMBEDDING_POLICY||p.building!==null&&(p.building!==m.targetSpace||p.building_policy!=='embedding2.unvalidated')))throw new EmbeddingIndexError('stale');return rows;
}
/** D0. No words, vectors, source IDs, URI, key or query are returned. Counts
 * are an inventory/cost ceiling, NOT a current-hash/full-coverage attestation. */
export async function readEmbeddingShadowInventory(db:Db,value:unknown,approvedHash:string){
 const m=manifest(value,approvedHash);if(m.signalRecovery)throw new EmbeddingIndexError('identity');
 return db.transaction(async tx=>{
  await targets(tx,m);
  const [row]=await tx.execute<{inspirations:string;signals:string;public_inspirations:string;inspiration_text_bytes:string;reflection_text_bytes:string;attachment_text_bytes:string;native_vectors:string;model2_vectors:string;pending_cells:string;unknown_attempts:string}>(sql`SELECT
   (SELECT count(*)::text FROM inspirations WHERE profile_id=ANY(${idsSql(m)})) AS inspirations,
   (SELECT count(*)::text FROM signals WHERE profile_id=ANY(${idsSql(m)})) AS signals,
   (SELECT count(*)::text FROM inspirations WHERE profile_id=ANY(${idsSql(m)}) AND visibility='public') AS public_inspirations,
   (SELECT coalesce(sum(octet_length(text)),0)::text FROM inspirations WHERE profile_id=ANY(${idsSql(m)})) AS inspiration_text_bytes,
   (SELECT coalesce(sum(octet_length(question)+octet_length(coalesce(answer,''))),0)::text FROM reflections WHERE profile_id=ANY(${idsSql(m)})) AS reflection_text_bytes,
   (SELECT coalesce(sum(octet_length(coalesce(enrichment_text,''))+octet_length(coalesce(transcript_correction,''))),0)::text FROM attachments WHERE profile_id=ANY(${idsSql(m)})) AS attachment_text_bytes,
   ((SELECT count(*) FROM inspiration_embeddings WHERE profile_id=ANY(${idsSql(m)}) AND model='gemini-embedding-001')+(SELECT count(*) FROM signal_embeddings WHERE profile_id=ANY(${idsSql(m)}) AND model='gemini-embedding-001'))::text AS native_vectors,
   ((SELECT count(*) FROM inspiration_embeddings WHERE profile_id=ANY(${idsSql(m)}) AND model=${m.targetSpace})+(SELECT count(*) FROM signal_embeddings WHERE profile_id=ANY(${idsSql(m)}) AND model=${m.targetSpace}))::text AS model2_vectors,
   (SELECT count(*)::text FROM embedding_index_work WHERE profile_id=ANY(${idsSql(m)}) AND space=${m.targetSpace} AND requested_version>completed_version) AS pending_cells,
   (SELECT count(*)::text FROM embedding_index_attempts WHERE profile_id=ANY(${idsSql(m)}) AND space=${m.targetSpace} AND status IN ('reserved','received','unknown')) AS unknown_attempts`);
  return {mode:'D0' as const,profiles:rowsCount(m),counts:row,currentHashCoverageProven:false,sourceContentsReturned:false,providerCalls:0,memoryMutations:0};
 },{isolationLevel:'repeatable read',accessMode:'read only'});
}
const rowsCount=(m:EmbeddingShadowManifest)=>m.profiles.length;
/** D1 metadata step. A bounded cohort barrier seeds missing work atomically.
 * Retries preserve existing requested/completed versions and source words. */
export async function prepareEmbeddingShadowBuild(db:Db,value:unknown,approvedHash:string){
 const m=manifest(value,approvedHash);if(m.signalRecovery)throw new EmbeddingIndexError('identity');
 return db.transaction(async tx=>{
  const fences=await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('waka.embedding-index:'||id::text,0)) AS locked FROM (SELECT unnest(${idsSql(m)}) AS id ORDER BY id) owners`);if(fences.some(p=>!p.locked))throw new EmbeddingIndexError('busy');
  await targets(tx,m);
  const generations=await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=ANY(${idsSql(m)}) ORDER BY profile_id FOR UPDATE NOWAIT`);if(generations.length!==m.profiles.length)throw new EmbeddingIndexError('missing');
  const [count]=await tx.execute<{cells:string}>(sql`SELECT ((SELECT count(*) FROM inspirations WHERE profile_id=ANY(${idsSql(m)}))+(SELECT count(*) FROM inspirations WHERE profile_id=ANY(${idsSql(m)}) AND visibility='public')+(SELECT count(*) FROM signals WHERE profile_id=ANY(${idsSql(m)})))::text AS cells`);if(BigInt(count.cells)>BigInt(m.maxInventoryCells))throw new EmbeddingIndexError('budget');
  await tx.execute(sql`INSERT INTO profile_embedding_indexes(profile_id) SELECT unnest(${idsSql(m)}) ON CONFLICT DO NOTHING`);
  await tx.execute(sql`UPDATE profile_embedding_indexes SET building_space=${m.targetSpace},building_threshold_policy='embedding2.unvalidated',updated_at=clock_timestamp() WHERE profile_id=ANY(${idsSql(m)})`);
  const seeded=await tx.execute(sql`INSERT INTO embedding_index_work(profile_id,space,source_kind,source_id,input_scope)
   SELECT profile_id,${m.targetSpace},'inspiration',id,'personal' FROM inspirations WHERE profile_id=ANY(${idsSql(m)})
   UNION ALL SELECT profile_id,${m.targetSpace},'inspiration',id,'public' FROM inspirations WHERE profile_id=ANY(${idsSql(m)}) AND visibility='public'
   UNION ALL SELECT profile_id,${m.targetSpace},'signal',id,'statement' FROM signals WHERE profile_id=ANY(${idsSql(m)})
   ON CONFLICT(profile_id,space,source_kind,source_id,input_scope) DO NOTHING RETURNING id`);
  return {mode:'D1_prepare' as const,profiles:rowsCount(m),inventoryCells:count.cells,newCells:seeded.length,providerCalls:0,activeSpaceChanged:false};
 });
}
/** D1 paid shadow slice. Explicitly approved invocation only. Durable manifest
 * call/byte caps span restarts; time/cell bounds apply per invocation. Stop on
 * first unresolved/failed cell, never silently retry or mint a new manifest. */
export async function runEmbeddingShadowBatch(db:Db,value:unknown,approvedHash:string,deps:Pick<IndexSourceDependencies,'client'>={}){
 const m=manifest(value,approvedHash);if(m.signalRecovery)throw new EmbeddingIndexError('identity');const started=performance.now(),deadlineAtMs=Date.now()+m.maxDurationMs;
 await db.transaction(async tx=>{const rows=await targets(tx,m);if(rows.some(p=>p.building!==m.targetSpace))throw new EmbeddingIndexError('identity');},{accessMode:'read only'});
 const cells=await db.execute<{profile_id:string;source_kind:'inspiration'|'signal';source_id:string;input_scope:'personal'|'public'|'statement'}>(sql`SELECT profile_id,source_kind,source_id,input_scope FROM embedding_index_work WHERE profile_id=ANY(${idsSql(m)}) AND space=${m.targetSpace} AND requested_version>completed_version ORDER BY requested_version,id LIMIT ${m.maxCellsPerInvocation}`);
 let completed=0,generated=0;
 for(const cell of cells){
  // Reserve enough time for one bounded HTTP exchange plus SQL reconciliation.
  if(performance.now()-started+17000>m.maxDurationMs||Date.parse(m.expiresAt)<=Date.now())break;
  const result=await indexEmbeddingSource(db,{profileId:cell.profile_id,sourceKind:cell.source_kind,sourceId:cell.source_id,space:m.targetSpace,scope:cell.input_scope},{...deps,dispatchDeadline:{expiresAtMs:Date.parse(m.expiresAt),deadlineAtMs},migration:{manifestHash:approvedHash,maxRequests:m.maxRequests,maxInputBytes:m.maxFormattedInputBytes},expectedPolicy:{profileId:cell.profile_id,activeSpace:'gemini-embedding-001',activeEpoch:BigInt(m.profiles.find(p=>p.id===cell.profile_id)!.epoch),activeThresholdPolicy:NATIVE_EMBEDDING_POLICY,buildingSpace:m.targetSpace}});
  if(result.status==='missing'||result.status==='inactive')throw new EmbeddingIndexError('stale');
  completed++;if(result.generated)generated++;
 }
 const [ledger]=await db.execute<{requests:string;bytes:string;unresolved:string}>(sql`SELECT count(*)::text AS requests,coalesce(sum(input_bytes),0)::text AS bytes,count(*) FILTER(WHERE status IN ('reserved','received','unknown'))::text AS unresolved FROM embedding_index_attempts WHERE manifest_hash=${approvedHash}`);
 return {mode:'D1' as const,completedCells:completed,generatedThisInvocation:generated,elapsedMs:Math.round(performance.now()-started),ledger,coverageProven:false,activeSpaceChanged:false,normalQueueBackfillJobs:0,referenceInputRateUsdPerMillion:0.20,operationalAllowanceIsBillingCap:false};
}

/** R1 is metadata-only explicit retry. Future ordinary queue dispatch remains
 * metered; approving this callable operation must include that intent. */
export async function renewEmbeddingSignalFromManifest(db:Db,value:unknown,approvedHash:string){
 const m=manifest(value,approvedHash),target=m.signalRecovery;
 if(!target||m.profiles.length!==1||m.profiles[0]!.id!==target.profileId)throw new EmbeddingIndexError('identity');
 const result=await renewKnownFailedSignalEmbedding(db,{accountId:m.accountId,profileId:target.profileId,signalId:target.signalId,expectedVersion:BigInt(target.workVersion),expectedEpoch:BigInt(m.profiles[0]!.epoch)});
 return {mode:'R1_signal' as const,renewedCells:result.renewed,providerCalls:0,ordinaryMeteredQueueIntent:result.renewed>0,ledgerReset:false,activeSpaceChanged:false};
}
