/** WHAT THIS MOCKS, AND WHY (gate G6): `GeminiEmbeddingClient` returns
 * synthetic vectors. Actual PG17 read-only inventory, barriers, bounded work
 * seeding, paid reservation/caps, source proofs and shadow writes execute. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {readEmbeddingShadowInventory,prepareEmbeddingShadowBuild,runEmbeddingShadowBatch,renewEmbeddingSignalFromManifest,embeddingShadowManifestHash,type EmbeddingShadowManifest} from './embedding-index-operator.js';
import {indexEmbeddingSource} from './embedding-indexer.js';
import {OpenRouterHttpError} from './openrouter-http.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
import {buildCanonicalInspirationEmbeddingInput,hashEmbeddingInput} from './inspiration-embeddings.js';
let t:TestDatabase;beforeAll(async()=>{t=await createTestDatabase();});afterAll(async()=>{await t?.cleanup();});
const vector=()=>[1,...Array<number>(767).fill(0)];
async function fixture(){
 const[a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`,[p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic') RETURNING id`;
 const[source]=await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES(${p.id},'PRIVATE_SYNTHETIC_WORDS do not export.','public') RETURNING id`;
 const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,locked_at) VALUES(${p.id},'Owner kept exact synthetic words.',now()) RETURNING id,statement`;
 await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding) VALUES(${p.id},${source.id},'gemini-embedding-001','personal',768,${hashEmbeddingInput(buildCanonicalInspirationEmbeddingInput({text:'PRIVATE_SYNTHETIC_WORDS do not export.',kind:null}))},${JSON.stringify(vector())}::jsonb)`;
 await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding) VALUES(${p.id},${signal.id},'gemini-embedding-001',768,${hashEmbeddingInput(signal.statement)},${JSON.stringify(vector())}::jsonb)`;
 const m:EmbeddingShadowManifest={version:'embedding2-shadow-v1',accountId:a.id,profiles:[{id:p.id,epoch:'0'}],targetSpace:EMBEDDING_2_SPACE.id,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString(),maxInventoryCells:10,maxCellsPerInvocation:10,maxRequests:10,maxFormattedInputBytes:10000,maxDurationMs:60000,operationalAllowanceUsd:.02};
 return {m,hash:embeddingShadowManifestHash(m),profileId:p.id as string,sourceId:source.id as string};
}
it('returns D0 aggregate counts without words/IDs/provider/memory writes or a false coverage claim',async()=>{
 const f=await fixture(),[before]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 const r=await readEmbeddingShadowInventory(t.db,f.m,f.hash);expect(r).toMatchObject({mode:'D0',counts:{inspirations:'1',signals:'1',public_inspirations:'1',model2_vectors:'0'},currentHashCoverageProven:false,providerCalls:0,memoryMutations:0});expect(JSON.stringify(r)).not.toContain('PRIVATE_SYNTHETIC');expect(JSON.stringify(r)).not.toContain(f.profileId);expect(JSON.stringify(r)).not.toContain(f.sourceId);
 expect((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`)[0]).toEqual(before);expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE profile_id=${f.profileId}`).toHaveLength(0);
});
it('seeds a bounded inactive shadow atomically and resumes without resetting completed/source versions or queue backfill',async()=>{
 const f=await fixture(),[before]=await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`;
 expect(await prepareEmbeddingShadowBuild(t.db,f.m,f.hash)).toMatchObject({inventoryCells:'3',newCells:3,activeSpaceChanged:false,providerCalls:0});
 const client={model:EMBEDDING_2_SPACE.id,embed:vi.fn(async()=>vector())};const r=await runEmbeddingShadowBatch(t.db,f.m,f.hash,{client});expect(r).toMatchObject({completedCells:3,generatedThisInvocation:3,coverageProven:false,normalQueueBackfillJobs:0,ledger:{requests:'3',unresolved:'0'}});expect(client.embed).toHaveBeenCalledTimes(3);
 const progress=await t.sql`SELECT id,requested_version,completed_version FROM embedding_index_work WHERE profile_id=${f.profileId} ORDER BY id`;
 expect(await prepareEmbeddingShadowBuild(t.db,f.m,f.hash)).toMatchObject({newCells:0});expect((await runEmbeddingShadowBatch(t.db,f.m,f.hash,{client})).generatedThisInvocation).toBe(0);expect(client.embed).toHaveBeenCalledTimes(3);expect(await t.sql`SELECT id,requested_version,completed_version FROM embedding_index_work WHERE profile_id=${f.profileId} ORDER BY id`).toEqual(progress);
 expect((await t.sql`SELECT active_space,active_epoch FROM profile_embedding_indexes WHERE profile_id=${f.profileId}`)[0]).toMatchObject({active_space:'gemini-embedding-001',active_epoch:'0'});expect((await t.sql`SELECT revision FROM generation_revisions WHERE profile_id=${f.profileId}`)[0]).toEqual(before);expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${f.profileId} AND type='index_embedding'`).toHaveLength(0);expect((await t.sql`SELECT text FROM inspirations WHERE id=${f.sourceId}`)[0].text).toContain('PRIVATE_SYNTHETIC_WORDS');
 expect((await readEmbeddingShadowInventory(t.db,f.m,f.hash)).counts).toMatchObject({native_vectors:'2',model2_vectors:'3'});
});
it('enforces manifest-wide call/byte caps across restarts without retrying a rejected reservation',async()=>{
 const f=await fixture();f.m.maxRequests=1;f.hash=embeddingShadowManifestHash(f.m);await prepareEmbeddingShadowBuild(t.db,f.m,f.hash);const client={model:EMBEDDING_2_SPACE.id,embed:vi.fn(async()=>vector())};
 await expect(runEmbeddingShadowBatch(t.db,f.m,f.hash,{client})).rejects.toMatchObject({code:'budget'});await expect(runEmbeddingShadowBatch(t.db,f.m,f.hash,{client})).rejects.toMatchObject({code:'budget'});expect(client.embed).toHaveBeenCalledOnce();expect(await t.sql`SELECT id FROM embedding_index_attempts WHERE manifest_hash=${f.hash}`).toHaveLength(1);
});
it('refuses a changed manifest, foreign owner, stale epoch or inventory ceiling before seeding/HTTP',async()=>{
 const f=await fixture();await expect(prepareEmbeddingShadowBuild(t.db,{...f.m,maxRequests:2},f.hash)).rejects.toMatchObject({code:'identity'});
 for(const changed of [{...f.m,accountId:randomUUID()},{...f.m,profiles:[{id:f.profileId,epoch:'1'}]},{...f.m,maxInventoryCells:1}])await expect(prepareEmbeddingShadowBuild(t.db,changed,embeddingShadowManifestHash(changed))).rejects.toBeDefined();
 expect(await t.sql`SELECT id FROM embedding_index_work WHERE profile_id=${f.profileId}`).toHaveLength(0);expect((await t.sql`SELECT building_space FROM profile_embedding_indexes WHERE profile_id=${f.profileId}`)[0].building_space).toBeNull();
});
it('binds metadata-only signal renewal to an exact approved account, profile, epoch and current failed work version',async()=>{
 const f=await fixture();await t.sql`UPDATE profile_embedding_indexes SET active_space=${EMBEDDING_2_SPACE.id},active_epoch=1,active_threshold_policy=${EMBEDDING_2_CANDIDATE_POLICY} WHERE profile_id=${f.profileId}`;
 const [signal]=await t.sql`SELECT id FROM signals WHERE profile_id=${f.profileId}`;await t.sql`SELECT embedding_index_request(${f.profileId},'signal',${signal.id},'statement')`;
 const client={model:EMBEDDING_2_SPACE.id,embed:vi.fn(async():Promise<number[]>=>{throw new OpenRouterHttpError('Closed synthetic failure',402);})};
 await expect(indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:signal.id,space:EMBEDDING_2_SPACE.id},{client})).rejects.toMatchObject({code:'provider_refused'});
 const [work]=await t.sql`SELECT requested_version FROM embedding_index_work WHERE source_id=${signal.id}`;
 const m={...f.m,profiles:[{id:f.profileId,epoch:'1'}],signalRecovery:{profileId:f.profileId,signalId:signal.id,workVersion:String(work.requested_version)}},hash=embeddingShadowManifestHash(m);
 await expect(runEmbeddingShadowBatch(t.db,m,hash,{client})).rejects.toMatchObject({code:'identity'});
 expect(await renewEmbeddingSignalFromManifest(t.db,m,hash)).toMatchObject({mode:'R1_signal',renewedCells:1,providerCalls:0,ordinaryMeteredQueueIntent:true,ledgerReset:false});
 await expect(renewEmbeddingSignalFromManifest(t.db,m,hash)).rejects.toMatchObject({code:'stale'});expect(client.embed).toHaveBeenCalledOnce();
});
