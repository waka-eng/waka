/** Privileged keyless C1. No caller proof/checker, provider, queue or repair. */
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {z} from 'zod';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY,NATIVE_EMBEDDING_POLICY,embeddingPolicyValidated} from './embedding-policy.js';
import {verifyEmbeddingCoverage,coverageFieldBytes,COVERAGE_TRANSFER_LIMITS,type EmbeddingCoverageManifest} from './embedding-index-coverage.js';

type Db=PostgresJsDatabase<typeof import('../db/index.js')>;
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
const version=z.string().regex(/^(0|[1-9]\d{0,18})$/);
export const embeddingCutoverManifest=z.object({
 version:z.literal('embedding-cutover-v1'),mode:z.enum(['covered','empty']),accountId:z.string().uuid(),
 profiles:z.array(z.object({id:z.string().uuid(),profileType:z.enum(['human','agent']),epoch:version,generation:version.nullable(),frontier:version,
  controlPresent:z.boolean(),coveredVersion:version.nullable(),buildingSpace:z.literal(EMBEDDING_2_SPACE.id).nullable(),buildingPolicy:z.literal('embedding2.unvalidated').nullable()}).strict()).min(1).max(32),
 targetSpace:z.literal(EMBEDDING_2_SPACE.id),thresholdPolicy:z.literal(EMBEDDING_2_CANDIDATE_POLICY),
 approvedDbSha256:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.string().datetime(),
 maxCells:z.number().int().min(1).max(1000),maxBytes:z.number().int().min(1048576).max(8388608),
 maxStatements:z.number().int().min(4).max(4096),maxDurationMs:z.literal(5000),maxLedgerAttempts:z.number().int().min(1).max(1000),
}).strict().superRefine((m,c)=>{
 const ids=m.profiles.map(p=>p.id);if(new Set(ids).size!==ids.length||JSON.stringify(ids)!==JSON.stringify([...ids].sort()))c.addIssue({code:'custom',message:'Targets must be unique and sorted'});
 if(m.profiles.some(p=>(p.buildingSpace===null)!==(p.buildingPolicy===null)||m.mode==='covered'&&(!p.controlPresent||p.generation===null||p.buildingSpace!==m.targetSpace)||m.mode==='empty'&&p.frontier!=='0'||!p.controlPresent&&(p.epoch!=='0'||p.coveredVersion!==null||p.buildingSpace!==null)))c.addIssue({code:'custom',message:'Invalid native before tuple'});
});
export type EmbeddingCutoverManifest=z.infer<typeof embeddingCutoverManifest>;
export class EmbeddingCutoverRefused extends Error{
 constructor(readonly code:'identity'|'scope'|'policy'|'busy'|'stale'|'coverage'|'unsupported_deadline'|'deadline'|'database'|'byte_limit'|'statement_limit'){
  super(`Embedding cutover refused: ${code}`);this.name='EmbeddingCutoverRefused';
 }
}
function parse(value:unknown,mutation=true){const r=embeddingCutoverManifest.safeParse(value);if(!r.success)throw new EmbeddingCutoverRefused('identity');if(mutation&&Date.parse(r.data.expiresAt)<=Date.now())throw new EmbeddingCutoverRefused('deadline');if(!embeddingPolicyValidated(r.data.targetSpace,r.data.thresholdPolicy))throw new EmbeddingCutoverRefused('policy');return r.data;}
function ids(m:EmbeddingCutoverManifest){return sql`ARRAY[${sql.join(m.profiles.map(p=>p.id).sort().map(id=>sql`${id}::uuid`),sql`, `)}]`;}
/** This is mandatory on the dedicated connection BEFORE any fence. PG16 must
 * refuse, not fall back to a JS/statement timer. No global/server setting. */
export async function setEmbeddingCutoverDeadline(tx:Pick<Tx,'execute'>){
 try{
  // First callback statement: even version inspection is covered. BEGIN/RC
  // setup precedes this and owns no source locks; child/idle bounds cover setup.
  await tx.execute(sql`SET LOCAL transaction_timeout='5s'`);
  const [v]=await tx.execute<{version:string}>(sql`SELECT current_setting('server_version_num') AS version`);
  if(!v||!Number.isSafeInteger(Number(v.version))||Number(v.version)<170000)throw new EmbeddingCutoverRefused('unsupported_deadline');
  await tx.execute(sql`SET LOCAL statement_timeout='1s'`);
  await tx.execute(sql`SET LOCAL lock_timeout='500ms'`);
  const [r]=await tx.execute<{bounded:boolean}>(sql`SELECT current_setting('transaction_timeout')::interval=interval '5 seconds' AS bounded`);
  if(!r?.bounded)throw new EmbeddingCutoverRefused('unsupported_deadline');
 }catch(e){if(e instanceof EmbeddingCutoverRefused)throw e;throw new EmbeddingCutoverRefused('unsupported_deadline');}
}
type Tuple={id:string;profile_type:'human'|'agent';generation:string|null;control_present:boolean;epoch:string;active_space:string;active_policy:string|null;building_space:string|null;building_policy:string|null;covered:string|null;frontier:string};
async function tuples(tx:Pick<Tx,'execute'>,m:EmbeddingCutoverManifest){
 const rows=await tx.execute<Tuple>(sql`SELECT p.id,p.type::text AS profile_type,g.revision::text AS generation,e.profile_id IS NOT NULL AS control_present,
  coalesce(e.active_epoch,0)::text AS epoch,coalesce(e.active_space,'gemini-embedding-001') AS active_space,CASE WHEN octet_length(coalesce(e.active_threshold_policy,${NATIVE_EMBEDDING_POLICY}))<=128 THEN coalesce(e.active_threshold_policy,${NATIVE_EMBEDDING_POLICY}) END AS active_policy,
  e.building_space,CASE WHEN octet_length(e.building_threshold_policy)<=128 THEN e.building_threshold_policy WHEN e.building_threshold_policy IS NULL THEN NULL ELSE '<oversized>' END AS building_policy,e.cutover_covered_version::text AS covered,
  coalesce((SELECT max(w.requested_version) FROM embedding_index_work w WHERE w.profile_id=p.id AND w.space=${m.targetSpace}),0)::text AS frontier
  FROM profiles p LEFT JOIN generation_revisions g ON g.profile_id=p.id LEFT JOIN profile_embedding_indexes e ON e.profile_id=p.id
  WHERE p.account_id=${m.accountId}::uuid AND p.id=ANY(${ids(m)}) AND p.type IN ('human','agent') ORDER BY p.id`);
 if(rows.length!==m.profiles.length)throw new EmbeddingCutoverRefused('scope');return rows;
}
function isBefore(r:Tuple,m:EmbeddingCutoverManifest){const p=m.profiles.find(p=>p.id===r.id)!;return r.profile_type===p.profileType&&r.control_present===p.controlPresent&&r.covered===p.coveredVersion&&r.epoch===p.epoch&&r.active_space==='gemini-embedding-001'&&r.active_policy===NATIVE_EMBEDDING_POLICY&&r.building_space===p.buildingSpace&&r.building_policy===p.buildingPolicy&&r.generation===p.generation&&r.frontier===p.frontier;}
function coverageManifest(m:EmbeddingCutoverManifest):EmbeddingCoverageManifest{return{
 version:'embedding-coverage-v1',accountId:m.accountId,profiles:m.profiles.map(p=>({id:p.id,epoch:p.epoch,activeSpace:'gemini-embedding-001',activePolicy:NATIVE_EMBEDDING_POLICY,buildingSpace:p.buildingSpace,buildingPolicy:p.buildingPolicy})),targetSpace:m.targetSpace,approvedDbSha256:m.approvedDbSha256,expiresAt:m.expiresAt,maxCells:m.maxCells,maxBytes:m.maxBytes,maxStatements:m.maxStatements,maxDurationMs:m.maxDurationMs,maxLedgerAttempts:m.maxLedgerAttempts,
};}
/** Exactly one transaction, zero retries. An uncertain COMMIT is an unknown
 * result: caller may reconcile tuples, never re-run this mutation automatically. */
export async function activateEmbeddingIndex(db:Db,value:unknown){
 const m=parse(value);
 return db.transaction(async rawTx=>{
  // Count every C1 statement, including fences/setup/mutation. Before each
  // bounded query reserve512KiB field payload; this is not a wire/heap bound.
  const started=performance.now();let statements=4,bytes=0;
  const tx={execute:async(query:Parameters<Tx['execute']>[0])=>{
   if(performance.now()-started>=5000||Date.parse(m.expiresAt)<=Date.now())throw new EmbeddingCutoverRefused('deadline');
   if(++statements>m.maxStatements)throw new EmbeddingCutoverRefused('statement_limit');
   if(m.maxBytes-bytes<COVERAGE_TRANSFER_LIMITS.statementBytes)throw new EmbeddingCutoverRefused('byte_limit');
   const result=await rawTx.execute(query);bytes+=coverageFieldBytes(result);if(bytes>m.maxBytes)throw new EmbeddingCutoverRefused('byte_limit');return result;
  }} as Tx;
  await setEmbeddingCutoverDeadline(tx);
  await tuples(tx,m); // Scope before touching another owner's advisory lock.
  const locks=await tx.execute<{locked:boolean}>(sql`SELECT pg_try_advisory_xact_lock(hashtextextended('waka.embedding-index:'||id::text,0)) AS locked FROM (SELECT unnest(${ids(m)}) AS id ORDER BY id) owners`);
  if(locks.length!==m.profiles.length||locks.some(r=>!r.locked))throw new EmbeddingCutoverRefused('busy');
  const owned=await tx.execute(sql`SELECT id FROM profiles WHERE account_id=${m.accountId}::uuid AND id=ANY(${ids(m)}) AND type IN ('human','agent') ORDER BY id FOR SHARE NOWAIT`);
  if(owned.length!==m.profiles.length)throw new EmbeddingCutoverRefused('scope');
  await tx.execute(sql`SELECT profile_id FROM generation_revisions WHERE profile_id=ANY(${ids(m)}) ORDER BY profile_id FOR UPDATE NOWAIT`);
  await tx.execute(sql`SELECT profile_id FROM profile_embedding_indexes WHERE profile_id=ANY(${ids(m)}) ORDER BY profile_id FOR UPDATE NOWAIT`);
  const before=await tuples(tx,m);if(before.some(r=>!isBefore(r,m)))throw new EmbeddingCutoverRefused('stale');
  let proof=await verifyEmbeddingCoverage(tx,coverageManifest(m));
  if(m.mode==='empty'){
   if(proof.report.counts.domainCells!==0||proof.report.unresolvedAttempts.total!==0)throw new EmbeddingCutoverRefused('coverage');
   await tx.execute(sql`INSERT INTO generation_revisions(profile_id) SELECT unnest(${ids(m)}) ON CONFLICT DO NOTHING`);
   await tx.execute(sql`INSERT INTO profile_embedding_indexes(profile_id) SELECT unnest(${ids(m)}) ON CONFLICT DO NOTHING`);
   // Zero-domain absence is proved before any INSERT. The strict core is still
   // mandatory after initialization; no minCells=1 paid intent is created.
   proof=await verifyEmbeddingCoverage(tx,coverageManifest(m));
  }
  if(!proof.report.complete||proof.report.counts.pendingWork||proof.report.unresolvedAttempts.total||proof.report.unresolvedAttempts.resolutionRequired||m.mode==='empty'&&proof.report.counts.domainCells!==0)throw new EmbeddingCutoverRefused('coverage');
  for(const p of m.profiles){const f=proof.privateMetadata.frontiers.find(r=>r.profileId===p.id);if(!f||f.maxRequestedVersion!==p.frontier||f.generationRevision!==(p.generation??'0'))throw new EmbeddingCutoverRefused('stale');}
  if(Date.parse(m.expiresAt)<=Date.now())throw new EmbeddingCutoverRefused('deadline');
  for(const p of [...m.profiles].sort((a,b)=>a.id.localeCompare(b.id)))await tx.execute(sql`UPDATE profile_embedding_indexes SET active_space=${m.targetSpace},active_epoch=active_epoch+1,active_threshold_policy=${m.thresholdPolicy},building_space=NULL,building_threshold_policy=NULL,cutover_covered_version=${p.frontier}::bigint,updated_at=clock_timestamp() WHERE profile_id=${p.id}::uuid`);
  await tx.execute(sql`SELECT advance_generation_revisions(${ids(m)})`);
  const after=await tuples(tx,m);
  return {activated:true as const,profiles:m.profiles.length,providerCalls:0 as const,coverage:proof.report,measurements:{statementBudgetUnits:statements,fieldPayloadBytes:bytes,elapsedMs:performance.now()-started},privateMetadata:{before,after}};
 },{isolationLevel:'read committed'});
}
/** New read authority references the exact unchanged historical intent. The
 * old expiry never extends mutation authority; read expiry is separate. */
export const embeddingCutoverReadOperation=z.object({version:z.literal('embedding-cutover-read-v1'),intent:embeddingCutoverManifest,intentSha256:z.string().regex(/^[a-f0-9]{64}$/),approvedDbSha256:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.string().datetime(),maxDurationMs:z.literal(5000)}).strict();
export function embeddingCutoverIntentHash(value:EmbeddingCutoverManifest){return createHash('sha256').update(JSON.stringify(embeddingCutoverManifest.parse(value))).digest('hex');}
/** One fresh whole-cohort metadata snapshot. No locks, writes or replay. Even
 * exact all-before is NOT proof of rollback while the old invocation may run. */
export async function reconcileEmbeddingCutover(db:Db,value:unknown){
 const parsed=embeddingCutoverReadOperation.safeParse(value);if(!parsed.success)throw new EmbeddingCutoverRefused('identity');
 const operation=parsed.data,m=parse(operation.intent,false);
 if(operation.intentSha256!==embeddingCutoverIntentHash(m)||operation.approvedDbSha256!==m.approvedDbSha256)throw new EmbeddingCutoverRefused('identity');
 if(Date.parse(operation.expiresAt)<=Date.now())throw new EmbeddingCutoverRefused('deadline');
 return db.transaction(async tx=>{
  await setEmbeddingCutoverDeadline(tx);const rows=await tuples(tx,m);
  const after=rows.every(r=>{const p=m.profiles.find(p=>p.id===r.id)!;return r.profile_type===p.profileType&&r.control_present&&r.active_space===m.targetSpace&&r.active_policy===m.thresholdPolicy&&BigInt(r.epoch)===BigInt(p.epoch)+1n&&r.building_space===null&&r.building_policy===null&&r.covered===p.frontier&&r.generation!==null&&BigInt(r.generation)>=BigInt(p.generation??'0')+1n;});
  return {state:after?'after' as const:rows.every(r=>isBefore(r,m))?'before_or_in_flight' as const:'hold' as const,profiles:rows.length,providerCalls:0 as const,activationReplayAuthorized:false as const,currentCoverageProven:false as const,privateMetadata:{tuples:rows}};
 },{isolationLevel:'read committed',accessMode:'read only'});
}
