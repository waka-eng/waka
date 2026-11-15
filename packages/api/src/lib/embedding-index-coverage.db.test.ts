/** WHAT THIS MOCKS, AND WHY (gate G6): `GeminiEmbeddingClient` is a fixed
 * fake at the paid HTTP seam. Actual PG17 canonical readers, migration/work,
 * vector publication, tenant predicates, RO/RR snapshots and bounds execute. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import postgres from 'postgres';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {readEmbeddingCoverage,embeddingCoverageManifest,type EmbeddingCoverageManifest} from './embedding-index-coverage.js';
import {prepareEmbeddingShadowBuild,runEmbeddingShadowBatch,embeddingShadowManifestHash,type EmbeddingShadowManifest} from './embedding-index-operator.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {readEmbeddingIndexSource} from './embedding-index-source.js';
import {hashEmbedding2Input} from './embedding-2-space.js';
let t:TestDatabase;
beforeAll(async()=>{
 const uri=new URL(process.env.DB_CONNECTION_URL!);expect(['127.0.0.1','localhost','::1','[::1]']).toContain(uri.hostname);
 t=await createTestDatabase();const[r]=await t.sql`SELECT current_setting('server_version_num') AS version,current_setting('data_directory') AS directory`;
 expect(Math.floor(Number(r.version)/10000)).toBe(17);if(process.env.WAKA_C0_LOCAL_DISPOSABLE_DIR)expect(r.directory).toBe(process.env.WAKA_C0_LOCAL_DISPOSABLE_DIR);
});afterAll(async()=>{await t?.cleanup();});
const vector=()=>[1,...Array<number>(767).fill(0)];
async function fixture(empty=false){
 const[a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
 const[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','PRIVATE_SYNTHETIC_NAME') RETURNING id`;
 let sourceId:string|undefined,signalId:string|undefined;
 if(!empty){
  [sourceId]= (await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES(${p.id},'PRIVATE_SYNTHETIC canonical words','public') RETURNING id`).map(x=>x.id);
  [signalId]= (await t.sql`INSERT INTO signals(profile_id,statement,locked_at,status,dismissed_at) VALUES(${p.id},'Owner-locked required refusal anchor.',now(),'retired',now()) RETURNING id`).map(x=>x.id);
 }
 const m:EmbeddingShadowManifest={version:'embedding2-shadow-v1',accountId:a.id,profiles:[{id:p.id,epoch:'0'}],targetSpace:EMBEDDING_2_SPACE.id,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxInventoryCells:1000,maxCellsPerInvocation:100,maxRequests:1000,maxFormattedInputBytes:48000000,maxDurationMs:60000,operationalAllowanceUsd:1};
 const client={model:EMBEDDING_2_SPACE.id,dimensions:768,embed:vi.fn(async()=>vector())};
 if(!empty){await prepareEmbeddingShadowBuild(t.db,m,embeddingShadowManifestHash(m));await runEmbeddingShadowBatch(t.db,m,embeddingShadowManifestHash(m),{client});}
 const coverage:EmbeddingCoverageManifest={version:'embedding-coverage-v1',accountId:a.id,profiles:[{id:p.id,epoch:'0',activeSpace:'gemini-embedding-001',activePolicy:'gemini-embedding-001.thresholds.v1',buildingSpace:empty?null:EMBEDDING_2_SPACE.id,buildingPolicy:empty?null:'embedding2.unvalidated'}],targetSpace:EMBEDDING_2_SPACE.id,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:1000,maxBytes:8388608,maxStatements:4096,maxDurationMs:60000,maxLedgerAttempts:1000};
 return {account:a.id as string,profile:p.id as string,sourceId:sourceId!,signalId:signalId!,m,hash:embeddingShadowManifestHash(m),client,coverage};
}
async function current(f:Awaited<ReturnType<typeof fixture>>){return readEmbeddingCoverage(t.db,f.coverage);}
it('proves actual owned current source/hash/finite vector/work including a locked dismissed anchor',async()=>{
 const f=await fixture(),before=await t.sql`SELECT id,requested_version,completed_version FROM embedding_index_work WHERE profile_id=${f.profile} ORDER BY id`;
 const r=await current(f);expect(r.report).toMatchObject({complete:true,counts:{domainCells:3,eligibleCells:3,currentCells:3},providerCalls:0,memoryMutations:0,providerOutcomeProven:false,invoiceProven:false,activationAuthorized:false});
 expect(await t.sql`SELECT id,requested_version,completed_version FROM embedding_index_work WHERE profile_id=${f.profile} ORDER BY id`).toEqual(before);
 expect(JSON.stringify(r.report)).not.toContain(f.profile);expect(JSON.stringify(r.report)).not.toContain(f.sourceId);expect(JSON.stringify(r.report)).not.toContain('PRIVATE_SYNTHETIC');expect(JSON.stringify(r.report)).not.toContain(hashEmbedding2Input('anything','RETRIEVAL_DOCUMENT'));
 expect(f.client.embed).toHaveBeenCalledTimes(3);
});
it('returns honest empty snapshot completeness without creating work/control or renewing anything',async()=>{
 const f=await fixture(true);const r=await current(f);expect(r.report).toMatchObject({complete:true,counts:{domainCells:0}});
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${f.profile}`).toHaveLength(0);expect(f.client.embed).not.toHaveBeenCalled();
});
it('does not accept pending=0 when vector or work is missing',async()=>{
 const f=await fixture();await t.sql`DELETE FROM inspiration_embeddings WHERE inspiration_id=${f.sourceId} AND model=${EMBEDDING_2_SPACE.id} AND input_scope='personal'`;
 expect((await current(f)).report).toMatchObject({complete:false,counts:{missingVector:1,pendingWork:0}});
 await t.sql`DELETE FROM embedding_index_work WHERE source_id=${f.signalId} AND profile_id=${f.profile}`;
 expect((await current(f)).report).toMatchObject({complete:false,counts:{missingWork:1}});
});
it('keeps an owned retained-agent profile readable without any legacy scope widening',async()=>{
 const f=await fixture();await t.sql`UPDATE profiles SET type='agent' WHERE id=${f.profile}`;
 expect((await current(f)).report.complete).toBe(true);
});
it('does not mistake an old native-space row for a target-space vector',async()=>{
 const f=await fixture();await t.sql`UPDATE signal_embeddings SET model='gemini-embedding-001' WHERE signal_id=${f.signalId} AND model=${EMBEDDING_2_SPACE.id}`;
 expect((await current(f)).report).toMatchObject({complete:false,counts:{missingVector:1}});
});
it('checks hash and actual geometry independently, suppressing oversized or malformed JSON before transfer',async()=>{
 const f=await fixture();await t.sql`UPDATE signal_embeddings SET input_hash=${'f'.repeat(64)} WHERE signal_id=${f.signalId} AND model=${EMBEDDING_2_SPACE.id}`;
 expect((await current(f)).report.counts.wrongHash).toBe(1);
 const input=(await readEmbeddingIndexSource(t.db,{profile_id:f.profile,source_kind:'signal',source_id:f.signalId,input_scope:'statement'})).input;
 await t.sql`UPDATE signal_embeddings SET input_hash=${hashEmbedding2Input(input,'RETRIEVAL_DOCUMENT')} WHERE signal_id=${f.signalId} AND model=${EMBEDDING_2_SPACE.id}`;
 for(const data of [[],{},['PRIVATE_BAD'],Array(768).fill(0),[1,...Array(766).fill(0)],[1e308,...Array(767).fill(0)],[1e-300,...Array(767).fill(0)]]){
  await t.sql`UPDATE signal_embeddings SET embedding=${JSON.stringify(data)}::jsonb WHERE signal_id=${f.signalId} AND model=${EMBEDDING_2_SPACE.id}`;
  const r=await current(f);expect(r.report).toMatchObject({complete:false,counts:{invalidGeometry:1}});expect(r.report.measurements.fieldPayloadBytes).toBeLessThan(65536);
 }
 await t.sql`UPDATE signal_embeddings SET embedding=${JSON.stringify(vector())}::jsonb,dimensions=767 WHERE signal_id=${f.signalId} AND model=${EMBEDDING_2_SPACE.id}`;
 expect((await current(f)).report.counts.invalidGeometry).toBe(1);
});
it('refuses foreign account/profile/policy and foreign exact-manifest reconciliation before any foreign counts',async()=>{
 const f=await fixture(),g=await fixture();
 await expect(readEmbeddingCoverage(t.db,{...f.coverage,accountId:g.account})).rejects.toMatchObject({code:'scope'});
 await expect(readEmbeddingCoverage(t.db,{...f.coverage,profiles:[{...f.coverage.profiles[0],epoch:'1'}]})).rejects.toMatchObject({code:'policy'});
 await expect(readEmbeddingCoverage(t.db,{...f.coverage,reconcileManifestHash:g.hash})).rejects.toMatchObject({code:'foreign_manifest'});
});
it('keeps unresolved paid outcomes separate from exact current coverage and never clears them',async()=>{
 const f=await fixture();await t.sql`UPDATE embedding_index_attempts SET status='unknown' WHERE manifest_hash=${f.hash}`;
 const r=await readEmbeddingCoverage(t.db,{...f.coverage,reconcileManifestHash:f.hash});
 expect(r.report).toMatchObject({complete:true,reconciliation:{found:true,attempts:3,unknown:3,committed:0,providerOutcomeProven:false,invoiceProven:false}});
 expect((await t.sql`SELECT count(*)::int AS n FROM embedding_index_attempts WHERE manifest_hash=${f.hash} AND status='unknown'`)[0].n).toBe(3);expect(f.client.embed).toHaveBeenCalledTimes(3);
 await expect(readEmbeddingCoverage(t.db,{...f.coverage,reconcileManifestHash:f.hash,maxLedgerAttempts:1})).rejects.toMatchObject({code:'ledger_limit'});
});
it('reports known HTTP categories and received outcome separately without retrying or modifying attempts',async()=>{
 const f=await fixture(),rows=await t.sql`SELECT id FROM embedding_index_attempts WHERE manifest_hash=${f.hash} ORDER BY id`;
 await t.sql`UPDATE embedding_index_attempts SET status='http_failed',http_status=429 WHERE id=${rows[0].id}`;
 await t.sql`UPDATE embedding_index_attempts SET status='http_failed',http_status=503 WHERE id=${rows[1].id}`;
 await t.sql`UPDATE embedding_index_attempts SET status='received' WHERE id=${rows[2].id}`;
 const r=await readEmbeddingCoverage(t.db,{...f.coverage,reconcileManifestHash:f.hash});
 expect(r.report).toMatchObject({complete:true,reconciliation:{attempts:3,httpFailed:2,http429:1,http4xx:1,http5xx:1,received:1,committed:0,providerOutcomeProven:false,invoiceProven:false}});expect(f.client.embed).toHaveBeenCalledTimes(3);
});
it('always includes other-manifest and deleted-source holds but excludes foreign account attempts',async()=>{
 const f=await fixture(),g=await fixture(),other='d'.repeat(64),gone=randomUUID();
 await t.sql`INSERT INTO embedding_index_attempts(account_id,profile_id,request_key,dispatch_family,purpose,manifest_hash,space,source_kind,source_id,input_scope,input_hash,input_bytes,status)
  VALUES(${f.account},${f.profile},${'orphan:'+randomUUID()},'index','migration',${other},${EMBEDDING_2_SPACE.id},'inspiration',${gone},'personal',${'e'.repeat(64)},42,'unknown'),
  (${g.account},${g.profile},${'foreign:'+randomUUID()},'index','migration',${other},${EMBEDDING_2_SPACE.id},'inspiration',${randomUUID()},'personal',${'e'.repeat(64)},42,'reserved')`;
 const r=await current(f);expect(r.report).toMatchObject({complete:true,reconciliation:null,counts:{domainCells:3},unresolvedAttempts:{reserved:0,received:0,unknown:1,total:1,resolutionRequired:true},providerOutcomeProven:false,activationAuthorized:false});
 const own=await readEmbeddingCoverage(t.db,{...f.coverage,reconcileManifestHash:f.hash});expect(own.report.reconciliation).toMatchObject({attempts:3,unknown:0,committed:3});expect(own.report.unresolvedAttempts.unknown).toBe(1);
 expect((await t.sql`SELECT status FROM embedding_index_attempts WHERE source_id=${gone}`)[0].status).toBe('unknown');expect(f.client.embed).toHaveBeenCalledTimes(3);
});
it('includes source edits/exclusion/public-to-private and deletion tombstones instead of omitting their work/vector domain',async()=>{
 const f=await fixture();await t.sql`UPDATE inspirations SET visibility='private',memory_excluded_at=now() WHERE id=${f.sourceId}`;
 const r=await current(f);expect(r.report.complete).toBe(false);expect(r.report.counts.domainCells).toBe(3);expect(r.report.counts.ineligibleCells).toBe(2);expect(r.report.counts.pendingWork).toBeGreaterThan(0);
 await runEmbeddingShadowBatch(t.db,f.m,f.hash,{client:f.client});expect((await current(f)).report).toMatchObject({complete:true,counts:{ineligibleCells:2}});expect(f.client.embed).toHaveBeenCalledTimes(3);
 await t.sql`DELETE FROM inspirations WHERE id=${f.sourceId}`;expect((await current(f)).report.counts.domainCells).toBe(3);
});
it('detects equal-time child-ID ordering changes using the exact canonical reader',async()=>{
 const f=await fixture();const time='2026-01-01T00:00:00Z';
 const low='10000000-0000-4000-8000-000000000010',high='10000000-0000-4000-8000-000000000090';
 await t.sql`INSERT INTO reflections(id,profile_id,inspiration_id,question,answer,created_at) VALUES(${low},${f.profile},${f.sourceId},'First?','First words.',${time}),(${high},${f.profile},${f.sourceId},'Second?','Second words.',${time})`;
 await runEmbeddingShadowBatch(t.db,f.m,f.hash,{client:f.client});expect((await current(f)).report.complete).toBe(true);
 await t.sql`UPDATE reflections SET id='10000000-0000-4000-8000-000000000099' WHERE id=${low}`;
 const r=await current(f);expect(r.report.complete).toBe(false);expect(r.report.counts.wrongHash).toBeGreaterThan(0);
});
it('includes extra public-vector rows even if the corresponding old work row was removed',async()=>{
 const f=await fixture();await t.sql`UPDATE inspirations SET visibility='private' WHERE id=${f.sourceId}`;
 await t.sql`DELETE FROM embedding_index_work WHERE source_id=${f.sourceId} AND profile_id=${f.profile} AND input_scope='public'`;
 await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding) VALUES(${f.profile},${f.sourceId},${EMBEDDING_2_SPACE.id},'public',768,${'c'.repeat(64)},${JSON.stringify(vector())}::jsonb) ON CONFLICT(inspiration_id,model,input_scope) DO UPDATE SET embedding=excluded.embedding`;
 const r=await current(f);expect(r.report.complete).toBe(false);expect(r.report.counts.domainCells).toBe(3);expect(r.report.counts.unexpectedVector).toBe(1);expect(r.report.counts.missingWork).toBe(1);
});
it('refuses raw child overflow before returning its words or subset completeness',async()=>{
 const f=await fixture();await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) SELECT ${f.profile}::uuid,${f.sourceId}::uuid,'Question','Synthetic answer' FROM generate_series(1,65)`;
 await expect(current(f)).rejects.toMatchObject({code:'source_limit'});
});
it('enforces max+1 domain, source, statement and deadline guards without returning subset coverage',async()=>{
 const f=await fixture();await expect(readEmbeddingCoverage(t.db,{...f.coverage,maxCells:2})).rejects.toMatchObject({code:'domain_limit'});
 await expect(readEmbeddingCoverage(t.db,{...f.coverage,maxStatements:4})).rejects.toMatchObject({code:'statement_limit'});
 let clock=0;await expect(readEmbeddingCoverage(t.db,{...f.coverage,maxDurationMs:1},{now:()=>clock++})).rejects.toMatchObject({code:'deadline'});
 await t.sql`UPDATE signals SET statement=${'X'.repeat(48001)} WHERE id=${f.signalId}`;
 await expect(current(f)).rejects.toMatchObject({code:'source_limit'});
});
it('uses a real READ ONLY transaction, with no control-creation helper reachable',async()=>{
 const f=await fixture(true);
 // Direct PostgreSQL proof, separate from C0's successful read contract.
 await expect(t.sql.begin('isolation level repeatable read read only',q=>q`UPDATE profiles SET name='MUST_NOT_WRITE' WHERE id=${f.profile}`)).rejects.toMatchObject({code:'25006'});
 expect((await current(f)).report.complete).toBe(true);
 expect(await t.sql`SELECT profile_id FROM profile_embedding_indexes WHERE profile_id=${f.profile}`).toHaveLength(0);
});
it('reports a true RR snapshot across a later commit; that old witness is not an activation input',async()=>{
 const f=await fixture(),uri=new URL(process.env.DB_CONNECTION_URL!);uri.searchParams.set('options','-c search_path='+t.schemaName);
 const writer=postgres(uri.toString(),{max:1,prepare:false,ssl:false,onnotice:()=>{}});
 let first=true;
 const proxy={transaction:(fn:Parameters<Parameters<typeof readEmbeddingCoverage>[0]['transaction']>[0],config:unknown)=>t.db.transaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='execute')return async(...args:unknown[])=>{const rows=await target.execute(args[0] as never);if(first){first=false;await writer`UPDATE signal_embeddings SET embedding=${JSON.stringify(Array(768).fill(0))}::jsonb WHERE signal_id=${f.signalId} AND model=${EMBEDDING_2_SPACE.id}`;}return rows;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}})),config as never)} as Parameters<typeof readEmbeddingCoverage>[0];
 const genBefore=(await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profile}`)[0].revision;
 try{
  const old=await readEmbeddingCoverage(proxy,f.coverage);expect(old.report.complete).toBe(true);
  expect((await current(f)).report).toMatchObject({complete:false,counts:{invalidGeometry:1}});
  expect((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profile}`)[0].revision).toBe(genBefore);
  expect(embeddingCoverageManifest.safeParse({...f.coverage,certificate:old}).success).toBe(false);
 }finally{await writer.end({timeout:1});}
});
it('closes an actual SQL failure without exposing query parameters or source identifiers',async()=>{
 const f=await fixture();await t.sql.unsafe('ALTER TABLE inspiration_embeddings RENAME TO c0_fixture_hidden_vectors');
 try{
  let error:unknown;try{await current(f);}catch(e){error=e;}
  expect(error).toMatchObject({code:'schema_mismatch'});expect(String(error)).not.toContain(f.profile);expect(JSON.stringify(error)).not.toContain(f.sourceId);expect(String(error)).not.toContain('SELECT');
 }finally{await t.sql.unsafe('ALTER TABLE c0_fixture_hidden_vectors RENAME TO inspiration_embeddings');}
});
