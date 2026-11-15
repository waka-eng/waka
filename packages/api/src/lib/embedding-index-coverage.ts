/** C0: bounded snapshot verification only. No provider, queue or mutation. */
import {sql,type SQL} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {z} from 'zod';
import type * as schema from '../db/index.js';
import {EMBEDDING_2_SPACE,hashEmbedding2Input} from './embedding-2-space.js';
import {readEmbeddingIndexSource,type EmbeddingSourceIdentity} from './embedding-index-source.js';
import {EmbeddingSourceReadLimit} from './embedding-source-limits.js';

type Db=PostgresJsDatabase<typeof schema>;
const hash=z.string().regex(/^[a-f0-9]{64}$/),epoch=z.string().regex(/^(0|[1-9]\d{0,18})$/);
export const embeddingCoverageManifest=z.object({
 version:z.literal('embedding-coverage-v1'),accountId:z.string().uuid(),
 profiles:z.array(z.object({id:z.string().uuid(),epoch,
  activeSpace:z.enum(['gemini-embedding-001',EMBEDDING_2_SPACE.id]),
  activePolicy:z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/),
  buildingSpace:z.literal(EMBEDDING_2_SPACE.id).nullable(),
  buildingPolicy:z.literal('embedding2.unvalidated').nullable(),
 }).strict()).min(1).max(32),
 targetSpace:z.literal(EMBEDDING_2_SPACE.id),approvedDbSha256:hash,expiresAt:z.string().datetime(),
 maxCells:z.number().int().min(1).max(1000),maxBytes:z.number().int().min(1048576).max(8388608),
 maxStatements:z.number().int().min(4).max(4096),maxDurationMs:z.number().int().min(1).max(60000),
 reconcileManifestHash:hash.optional(),maxLedgerAttempts:z.number().int().min(1).max(1000),
}).strict().superRefine((m,c)=>{
 if(new Set(m.profiles.map(p=>p.id)).size!==m.profiles.length)c.addIssue({code:'custom',message:'Duplicate target'});
 if(m.profiles.some(p=>(p.buildingSpace===null)!==(p.buildingPolicy===null)))c.addIssue({code:'custom',message:'Invalid build policy'});
});
export type EmbeddingCoverageManifest=z.infer<typeof embeddingCoverageManifest>;
export class EmbeddingCoverageRefused extends Error{
 constructor(readonly code:'identity'|'scope'|'policy'|'foreign_manifest'|'domain_limit'|'source_limit'|'byte_limit'|'statement_limit'|'deadline'|'ledger_limit'|'read_bound'|'database_read'|'statement_timeout'|'lock_timeout'|'readonly_violation'|'schema_mismatch'){
  super(`Embedding coverage refused: ${code}`);this.name='EmbeddingCoverageRefused';
 }
}
function databaseRefusal(error:unknown){
 if(error instanceof EmbeddingCoverageRefused)return error;
 let cause=error;
 for(let i=0;i<4&&cause&&typeof cause==='object';i++){
  const code=String((cause as {code?:unknown}).code??'');
  if(code==='57014')return new EmbeddingCoverageRefused('statement_timeout');
  if(code==='55P03')return new EmbeddingCoverageRefused('lock_timeout');
  if(code==='25006')return new EmbeddingCoverageRefused('readonly_violation');
  if(['42P01','42703'].includes(code))return new EmbeddingCoverageRefused('schema_mismatch');
  cause=(cause as {cause?:unknown}).cause;
 }
 return new EmbeddingCoverageRefused('database_read');
}
export const COVERAGE_TRANSFER_LIMITS={statementBytes:524288,vectorBytes:65536} as const;
/** Finite coordinates can still overflow/underflow the norm. Never rescale. */
export function finiteCoverageGeometry(values:unknown,dimensions:number):boolean{
 if(dimensions!==768||!Array.isArray(values)||values.length!==768)return false;
 let squared=0;for(const value of values){if(typeof value!=='number'||!Number.isFinite(value))return false;squared+=value*value;}
 return Number.isFinite(squared)&&squared>0;
}
/** Field-payload accounting, not a physical TLS/wire or heap-size claim. */
export function coverageFieldBytes(value:unknown):number{
 if(value===null||value===undefined)return 4;
 if(typeof value==='string')return Buffer.byteLength(value)+4;
 if(value instanceof Date)return 40;
 if(typeof value==='number'||typeof value==='boolean'||typeof value==='bigint')return Buffer.byteLength(String(value))+4;
 if(Array.isArray(value))return value.reduce((n,v)=>n+coverageFieldBytes(v),0)+8;
 if(typeof value==='object'){
  const row=value as Record<string,unknown>;
  return Object.entries(row).reduce<number>((n,[k,v])=>n+(k==='values'&&v!==null&&typeof row.vector_bytes==='number'?row.vector_bytes+4:coverageFieldBytes(v)),0)+8;
 }
 throw new EmbeddingCoverageRefused('read_bound');
}
type Cell=EmbeddingSourceIdentity;
const reasons=()=>({missingWork:0,pendingWork:0,invalidWork:0,missingVector:0,wrongHash:0,invalidGeometry:0,unexpectedVector:0,missingGeneration:0});
type CellRow={work_id:string|null;requested:string|null;completed:string|null;completed_hash:string|null;outcome:string|null;
 vector_id:string|null;dimensions:number|null;input_hash:string|null;values:unknown;vector_bytes:number|null;vector_allowed:boolean|null};

/** Explicit RO/RR is mandatory. No certificate is accepted as an input. */
export async function readEmbeddingCoverage(db:Db,value:unknown,options:{now?:()=>number}={}){
 const parsed=embeddingCoverageManifest.safeParse(value);if(!parsed.success)throw new EmbeddingCoverageRefused('identity');
 const m=parsed.data,now=options.now??(()=>performance.now()),started=now(),expiry=Date.parse(m.expiresAt),deadline=started+Math.min(m.maxDurationMs,expiry-Date.now());
 if(!Number.isFinite(deadline)||deadline<=started)throw new EmbeddingCoverageRefused('deadline');
 // Reserve BEGIN, SET TRANSACTION, COMMIT/ROLLBACK and one cold type-catalog
 // statement. These budget units are not a claim that a warm client ran all4.
 const reservedControlStatements=4;let applicationStatements=0,fieldBytes=0,rowsRead=0;
 const check=()=>{if(now()>=deadline||Date.now()>=expiry)throw new EmbeddingCoverageRefused('deadline');};
 return db.transaction(async tx=>{
  const execute=async<T extends Record<string,unknown>>(query:SQL):Promise<T[]>=>{
   check();if(applicationStatements+reservedControlStatements>=m.maxStatements)throw new EmbeddingCoverageRefused('statement_limit');
   // Every query below returns fixed bounded metadata or server-guarded fields.
   // Reserve its maximum transfer BEFORE executing, not after fetching a blob.
   if(m.maxBytes-fieldBytes<COVERAGE_TRANSFER_LIMITS.statementBytes)throw new EmbeddingCoverageRefused('byte_limit');
   applicationStatements++;let rows;
   try{rows=await tx.execute<T>(query);}catch(error){throw databaseRefusal(error);}
   const bytes=coverageFieldBytes(rows);
   if(bytes>COVERAGE_TRANSFER_LIMITS.statementBytes)throw new EmbeddingCoverageRefused('read_bound');
   fieldBytes+=bytes;rowsRead+=rows.length;check();return rows as T[];
  };
  // Source helper's account-bound branch uses only execute. No select/writer or
  // index-fence helper is exposed through this port.
  const reader={execute} as unknown as Db;
  const ids=sql`ARRAY[${sql.join(m.profiles.map(p=>sql`${p.id}::uuid`),sql`, `)}]`;
  const owned=await execute<{id:string;epoch:string;active_space:string;active_policy:string|null;policy_oversized:boolean;building_space:string|null;building_policy:string|null;generation:string|null;snapshot_at:string}>(sql`SELECT p.id,
   coalesce(e.active_epoch,0)::text AS epoch,coalesce(e.active_space,'gemini-embedding-001') AS active_space,
   CASE WHEN octet_length(coalesce(e.active_threshold_policy,'gemini-embedding-001.thresholds.v1'))<=128 THEN coalesce(e.active_threshold_policy,'gemini-embedding-001.thresholds.v1') END AS active_policy,
   octet_length(coalesce(e.active_threshold_policy,''))>128 OR octet_length(coalesce(e.building_threshold_policy,''))>128 AS policy_oversized,e.building_space,
   CASE WHEN octet_length(coalesce(e.building_threshold_policy,''))<=128 THEN e.building_threshold_policy END AS building_policy,g.revision::text AS generation,transaction_timestamp()::text AS snapshot_at
   FROM profiles p LEFT JOIN profile_embedding_indexes e ON e.profile_id=p.id LEFT JOIN generation_revisions g ON g.profile_id=p.id
   WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids}) AND p.type IN ('human','agent') ORDER BY p.id`);
  if(owned.length!==m.profiles.length)throw new EmbeddingCoverageRefused('scope');
  for(const row of owned){const expected=m.profiles.find(p=>p.id===row.id)!;
   if(row.policy_oversized||row.epoch!==expected.epoch||row.active_space!==expected.activeSpace||row.active_policy!==expected.activePolicy||row.building_space!==expected.buildingSpace||row.building_policy!==expected.buildingPolicy)throw new EmbeddingCoverageRefused('policy');
  }
  // One cohort aggregate across every live/migration manifest. Deleted source
  // attempts remain visible: do not join to current source/work/vector rows.
  const [unresolved]=await execute<{reserved:number;received:number;unknown:number;total:number}>(sql`SELECT
   count(*) FILTER(WHERE a.status='reserved')::int AS reserved,count(*) FILTER(WHERE a.status='received')::int AS received,
   count(*) FILTER(WHERE a.status='unknown')::int AS unknown,count(*)::int AS total
   FROM embedding_index_attempts a JOIN profiles p ON p.id=a.profile_id AND p.account_id=a.account_id
   WHERE a.account_id=${m.accountId}::uuid AND a.profile_id=ANY(${ids}) AND a.space=${m.targetSpace} AND a.status IN ('reserved','received','unknown')`);
  if(!unresolved||unresolved.total>m.maxLedgerAttempts)throw new EmbeddingCoverageRefused('ledger_limit');
  const unresolvedAttempts={...unresolved,resolutionRequired:unresolved.total>0};
  let reconciliation:null|{found:boolean;attempts:number;formattedBytes:string;reserved:number;received:number;unknown:number;committed:number;stale:number;httpFailed:number;http429:number;http4xx:number;http5xx:number;providerOutcomeProven:false;invoiceProven:false}=null;
  if(m.reconcileManifestHash){
   // Return no foreign count. RR fixes this scope proof for the later aggregate.
   const [foreign]=await execute<{invalid:boolean}>(sql`SELECT EXISTS(SELECT 1 FROM embedding_index_attempts a
    WHERE a.manifest_hash=${m.reconcileManifestHash} AND (a.account_id<>${m.accountId}::uuid OR NOT(a.profile_id=ANY(${ids})) OR a.space<>${m.targetSpace}
     OR NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=a.profile_id AND p.account_id=${m.accountId}::uuid))) AS invalid`);
   if(foreign?.invalid)throw new EmbeddingCoverageRefused('foreign_manifest');
   const [r]=await execute<{attempts:number;bytes:string;reserved:number;received:number;unknown:number;committed:number;stale:number;failed:number;h429:number;h4xx:number;h5xx:number}>(sql`SELECT count(*)::int AS attempts,coalesce(sum(a.input_bytes),0)::text AS bytes,
    count(*) FILTER(WHERE a.status='reserved')::int AS reserved,count(*) FILTER(WHERE a.status='received')::int AS received,
    count(*) FILTER(WHERE a.status='unknown')::int AS unknown,count(*) FILTER(WHERE a.status='committed')::int AS committed,
    count(*) FILTER(WHERE a.status='stale')::int AS stale,count(*) FILTER(WHERE a.status='http_failed')::int AS failed,
    count(*) FILTER(WHERE a.status='http_failed' AND a.http_status=429)::int AS h429,
    count(*) FILTER(WHERE a.status='http_failed' AND a.http_status BETWEEN 400 AND 499)::int AS h4xx,
    count(*) FILTER(WHERE a.status='http_failed' AND a.http_status BETWEEN 500 AND 599)::int AS h5xx
    FROM embedding_index_attempts a JOIN profiles p ON p.id=a.profile_id AND p.account_id=a.account_id
    WHERE a.manifest_hash=${m.reconcileManifestHash} AND a.account_id=${m.accountId}::uuid AND a.profile_id=ANY(${ids}) AND a.space=${m.targetSpace}`);
   if(!r||r.attempts>m.maxLedgerAttempts)throw new EmbeddingCoverageRefused('ledger_limit');
   reconciliation={found:r.attempts>0,attempts:r.attempts,formattedBytes:r.bytes,reserved:r.reserved,received:r.received,unknown:r.unknown,committed:r.committed,stale:r.stale,httpFailed:r.failed,http429:r.h429,http4xx:r.h4xx,http5xx:r.h5xx,providerOutcomeProven:false,invoiceProven:false};
  }
  const cells=await execute<Cell&Record<string,unknown>>(sql`WITH domain AS (
   SELECT i.profile_id,'inspiration'::text AS source_kind,i.id AS source_id,'personal'::text AS input_scope FROM inspirations i JOIN profiles p ON p.id=i.profile_id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids})
   UNION SELECT i.profile_id,'inspiration',i.id,'public' FROM inspirations i JOIN profiles p ON p.id=i.profile_id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids}) AND i.visibility='public'
   UNION SELECT s.profile_id,'signal',s.id,'statement' FROM signals s JOIN profiles p ON p.id=s.profile_id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids})
   UNION SELECT w.profile_id,w.source_kind,w.source_id,w.input_scope FROM embedding_index_work w JOIN profiles p ON p.id=w.profile_id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids}) AND w.space=${m.targetSpace}
   UNION SELECT v.profile_id,'inspiration',v.inspiration_id,v.input_scope::text FROM inspiration_embeddings v JOIN profiles p ON p.id=v.profile_id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids}) AND v.model=${m.targetSpace}
   UNION SELECT v.profile_id,'signal',v.signal_id,'statement' FROM signal_embeddings v JOIN profiles p ON p.id=v.profile_id WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids}) AND v.model=${m.targetSpace}
  ) SELECT * FROM domain ORDER BY profile_id,source_kind,source_id,input_scope LIMIT ${m.maxCells+1}`);
  if(cells.length>m.maxCells)throw new EmbeddingCoverageRefused('domain_limit');
  const holes=reasons();holes.missingGeneration=owned.filter(p=>p.generation===null).length;
  let eligible=0,ineligible=0,current=0;
  const frontiers=new Map(owned.map(p=>[p.id,0n]));
  for(const cell of cells){
   check();let source;
   try{source=await readEmbeddingIndexSource(reader,cell,false,m.accountId);}catch(error){if(error instanceof EmbeddingSourceReadLimit)throw new EmbeddingCoverageRefused('source_limit');throw error;}
   if(source.eligible&&Buffer.byteLength(source.input)>48000)throw new EmbeddingCoverageRefused('source_limit');
   const expectedHash=source.eligible?hashEmbedding2Input(source.input,'RETRIEVAL_DOCUMENT'):null;
   const vectorTable=cell.source_kind==='inspiration'?sql`inspiration_embeddings`:sql`signal_embeddings`;
   const vectorId=cell.source_kind==='inspiration'?sql`v.inspiration_id`:sql`v.signal_id`;
   const vectorScope=cell.source_kind==='inspiration'?sql` AND v.input_scope=${cell.input_scope}`:sql``;
   const [r]=await execute<CellRow>(sql`SELECT w.id AS work_id,w.requested_version::text AS requested,w.completed_version::text AS completed,
    CASE WHEN octet_length(w.completed_input_hash)=64 THEN w.completed_input_hash END AS completed_hash,w.outcome,v.id AS vector_id,v.dimensions,
    CASE WHEN octet_length(v.input_hash)=64 THEN v.input_hash END AS input_hash,
    CASE WHEN jsonb_typeof(v.embedding)='array' THEN CASE WHEN jsonb_array_length(v.embedding)=768 AND octet_length(v.embedding::text)<=${COVERAGE_TRANSFER_LIMITS.vectorBytes} THEN v.embedding END END AS values,
    octet_length(v.embedding::text) AS vector_bytes,
    CASE WHEN jsonb_typeof(v.embedding)='array' THEN jsonb_array_length(v.embedding)=768 AND octet_length(v.embedding::text)<=${COVERAGE_TRANSFER_LIMITS.vectorBytes} ELSE false END AS vector_allowed
    FROM profiles p LEFT JOIN embedding_index_work w ON w.profile_id=p.id AND w.space=${m.targetSpace} AND w.source_kind=${cell.source_kind} AND w.source_id=${cell.source_id}::uuid AND w.input_scope=${cell.input_scope}
    LEFT JOIN ${vectorTable} v ON v.profile_id=p.id AND ${vectorId}=${cell.source_id}::uuid AND v.model=${m.targetSpace}${vectorScope}
    WHERE p.id=${cell.profile_id}::uuid AND p.account_id=${m.accountId}::uuid LIMIT 1`);
   if(!r)throw new EmbeddingCoverageRefused('scope');
   const before={...holes};
   if(!r.work_id)holes.missingWork++;
   else{
    const requested=BigInt(r.requested!),completed=BigInt(r.completed!);if(requested>frontiers.get(cell.profile_id)!)frontiers.set(cell.profile_id,requested);
    if(requested!==completed)holes.pendingWork++;
    if(source.eligible?r.outcome!=='current'||r.completed_hash!==expectedHash:r.outcome!=='ineligible'||r.completed_hash!==null)holes.invalidWork++;
   }
   if(source.eligible){eligible++;
    if(!r.vector_id)holes.missingVector++;
    else{if(r.input_hash!==expectedHash)holes.wrongHash++;if(!r.vector_allowed||!finiteCoverageGeometry(r.values,r.dimensions!))holes.invalidGeometry++;}
   }else{ineligible++;if(r.vector_id)holes.unexpectedVector++;}
   if(Object.keys(holes).every(k=>holes[k as keyof typeof holes]===before[k as keyof typeof holes]))current++;
  }
  check();const complete=Object.values(holes).every(n=>n===0);
  return {report:{snapshotAt:owned[0]!.snapshot_at,complete,counts:{profiles:owned.length,domainCells:cells.length,eligibleCells:eligible,ineligibleCells:ineligible,currentCells:current,...holes},unresolvedAttempts,reconciliation,
    measurements:{applicationStatements,reservedControlStatements,statementBudgetUnits:applicationStatements+reservedControlStatements,fieldPayloadBytes:fieldBytes,rowsRead,elapsedMs:Math.max(0,now()-started)},providerCalls:0 as const,memoryMutations:0 as const,providerOutcomeProven:false as const,invoiceProven:false as const,activationAuthorized:false as const},
   privateMetadata:{frontiers:owned.map(p=>({profileId:p.id,epoch:p.epoch,generationRevision:p.generation,maxRequestedVersion:frontiers.get(p.id)!.toString()}))}};
 },{isolationLevel:'repeatable read',accessMode:'read only'}).catch(error=>{throw databaseRefusal(error);});
}
