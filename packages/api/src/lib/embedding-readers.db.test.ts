/** WHAT THIS MOCKS, AND WHY (gate G6): `GeminiEmbeddingClient` and
 * `ModelProvider.judgeSignalMatch` return fixed synthetic results. Actual
 * PG17 current sources, selected spaces, routes, receipts and matching run. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createRecallRoutes} from '../routes/recall.js';
import type {AuthEnv} from './middleware.js';
import {EMBEDDING_2_SPACE,hashEmbedding2Input} from './embedding-2-space.js';
import {EMBEDDING_2_CANDIDATE_POLICY} from './embedding-policy.js';
import {readEmbeddingIndexPolicy} from './embedding-index-coordination.js';
import {indexEmbeddingSource} from './embedding-indexer.js';
import {hasCurrentConversationIndex,readSemanticConversationCandidates} from './conversation-retrieval.js';
import {applyCandidates} from './signal-match-or-mint.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';
import {readGenerationRevision,assertGenerationRevision} from './generation-revision.js';
import type {ModelProvider} from './model-provider.js';
let t:TestDatabase;beforeAll(async()=>{t=await createTestDatabase();});afterAll(async()=>{await t?.cleanup();});
const vector=()=>[1,...Array<number>(767).fill(0)];
async function person(thresholdPolicy=EMBEDDING_2_CANDIDATE_POLICY){
 const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
 const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic') RETURNING id`;
 await t.sql`INSERT INTO profile_embedding_indexes(profile_id,active_space,active_epoch,active_threshold_policy) VALUES(${p.id},${EMBEDDING_2_SPACE.id},1,${thresholdPolicy})`;
 const [session]=await t.sql`INSERT INTO sessions(profile_id,token_hash,expires_at) VALUES(${p.id},${randomUUID().replaceAll('-','').padEnd(64,'0')},now()+interval '1 day') RETURNING id`;
 return {profileId:p.id as string,accountId:a.id as string,sessionId:session.id as string};
}
async function source(profileId:string,text='I make room for quiet mornings.'){
 const [r]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profileId},${text}) RETURNING id`;return r.id as string;
}
async function signal(profileId:string){
 const id=await source(profileId),[s]=await t.sql`INSERT INTO signals(profile_id,statement,status,locked_at) VALUES(${profileId},'I prefer quiet mornings.','emerging',now()) RETURNING id,statement`;
 await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES(${profileId},${profileId},${s.id},${id})`;
 await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding) VALUES(${profileId},${s.id},'gemini-embedding-001',768,${hashEmbeddingInput(s.statement)},${JSON.stringify(vector())}::jsonb)`;
 return {id:s.id as string,statement:s.statement as string};
}
function recall(f:Awaited<ReturnType<typeof person>>,embed=vi.fn(async()=>vector())){
 const app=new Hono<AuthEnv>();app.route('/recall',createRecallRoutes({getDatabase:()=>t.db as never,embedClient:{model:EMBEDDING_2_SPACE.id,dimensions:768,embed},authMiddleware:async(c,next)=>{c.set('session',{sessionId:f.sessionId,account:{id:f.accountId,email:'synthetic@example.test'},profile:{id:f.profileId,accountId:f.accountId,type:'human',name:'Synthetic',preferredLocale:'en-US'}});await next();}}));return {app,embed};
}
it('does not mistake old-space eligible memory for empty and buys no query without compatible current vectors',async()=>{
 const f=await person(),s=await signal(f.profileId),r=recall(f);
 const unavailable=await r.app.request('/recall?q=quiet%20mornings');expect(unavailable.status).toBe(503);expect(await unavailable.json()).toMatchObject({code:'recall_index_incomplete',recall:{state:'unavailable',matches:[],coverage:{compatible:0,scanned:1}}});expect(r.embed).not.toHaveBeenCalled();
 expect(await t.sql`SELECT * FROM account_recall_limits WHERE account_id=${f.accountId}`).toHaveLength(0);
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:s.id,space:EMBEDDING_2_SPACE.id},{client:{model:EMBEDDING_2_SPACE.id,embed:async()=>vector()}});
 const ready=await r.app.request('/recall?q=quiet%20mornings');expect(ready.status).toBe(200);expect(await ready.json()).toMatchObject({recall:{state:'ready',matches:[{signalId:s.id,locked:true}]}});expect(r.embed).toHaveBeenCalledOnce();
 expect(await t.sql`SELECT model FROM signal_embeddings WHERE signal_id=${s.id}`).toHaveLength(2);
});
it('holds recall and chat when the installed model2 policy is unreviewed even with matching stored vectors',async()=>{
 const f=await person(),s=await signal(f.profileId),id=await source(f.profileId);
 const client={model:EMBEDDING_2_SPACE.id,embed:async()=>vector()};
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:s.id,space:EMBEDDING_2_SPACE.id},{client});
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'inspiration',sourceId:id,space:EMBEDDING_2_SPACE.id},{client});
 await t.sql`UPDATE profile_embedding_indexes SET active_threshold_policy='integration-unreviewed' WHERE profile_id=${f.profileId}`;
 const policy=await readEmbeddingIndexPolicy(t.db,f.profileId),r=recall(f);
 const response=await r.app.request('/recall?q=quiet%20mornings');
 expect(response.status).toBe(503);
 expect(await response.json()).toMatchObject({code:'recall_index_incomplete'});
 expect(r.embed).not.toHaveBeenCalled();
 expect(await hasCurrentConversationIndex(t.db,f.profileId,policy)).toBe(false);
 expect(await t.sql`SELECT model FROM signal_embeddings WHERE signal_id=${s.id}`).toHaveLength(2);
});

it('rechecks policy after query HTTP and emits no cross-space matches or new public state enum',async()=>{
 const f=await person(),s=await signal(f.profileId);await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:s.id,space:EMBEDDING_2_SPACE.id},{client:{model:EMBEDDING_2_SPACE.id,embed:async()=>vector()}});
 const r=recall(f,vi.fn(async()=>{await t.sql`UPDATE profile_embedding_indexes SET active_epoch=active_epoch+1 WHERE profile_id=${f.profileId}`;return vector();}));const response=await r.app.request('/recall?q=quiet%20mornings');expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'recall_sources_changed',recall:{state:'unavailable',matches:[]}});expect(r.embed).toHaveBeenCalledOnce();
});
it('returns unavailable rather than false empty when a current far vector hides eligible old-space-only memory',async()=>{
 const f=await person(),far=await signal(f.profileId);await signal(f.profileId);
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:far.id,space:EMBEDDING_2_SPACE.id},{client:{model:EMBEDDING_2_SPACE.id,embed:async()=>[0,1,...Array<number>(766).fill(0)]}});
 const r=recall(f),response=await r.app.request('/recall?q=quiet%20mornings');expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'recall_index_incomplete',recall:{state:'unavailable',matches:[],coverage:{compatible:1,scanned:2}}});expect(r.embed).toHaveBeenCalledOnce();
});
it('refuses a wholly replaced current candidate set after HTTP even when fresh coverage is complete',async()=>{
 const f=await person(),old=await signal(f.profileId),client={model:EMBEDDING_2_SPACE.id,embed:async()=>vector()};await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:old.id,space:EMBEDDING_2_SPACE.id},{client});
 const r=recall(f,vi.fn(async()=>{const fresh=await signal(f.profileId);await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:fresh.id,space:EMBEDDING_2_SPACE.id},{client});await t.sql`DELETE FROM signals WHERE id=${old.id}`;return vector();}));
 const response=await r.app.request('/recall?q=quiet%20mornings');expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'recall_sources_changed',recall:{state:'unavailable',matches:[]}});
});
it('proves canonical selected-space material before query eligibility and rejects edits, exclusions and foreign sources',async()=>{
 const f=await person(),foreign=await person(),id=await source(f.profileId),other=await source(foreign.profileId),c={model:EMBEDDING_2_SPACE.id,embed:vi.fn(async()=>vector())};
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'inspiration',sourceId:id,space:EMBEDDING_2_SPACE.id},{client:c});
 const policy=await readEmbeddingIndexPolicy(t.db,f.profileId);
 expect(await hasCurrentConversationIndex(t.db as never,f.profileId,policy)).toBe(true);
 expect((await readSemanticConversationCandidates(t.db as never,f.profileId,vector(),undefined,[],policy)).candidates.map(row=>row.id)).toEqual([id]);
 await t.sql`UPDATE inspirations SET text='Changed exact current words.' WHERE id=${id}`;
 expect(await hasCurrentConversationIndex(t.db as never,f.profileId,policy)).toBe(false);expect((await readSemanticConversationCandidates(t.db as never,f.profileId,vector(),undefined,[],policy)).candidates).toEqual([]);
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'inspiration',sourceId:id,space:EMBEDDING_2_SPACE.id},{client:c});
 await t.sql`UPDATE inspirations SET memory_excluded_at=now() WHERE id=${id}`;expect(await hasCurrentConversationIndex(t.db as never,f.profileId,policy)).toBe(false);
 await expect(indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'inspiration',sourceId:other,space:EMBEDDING_2_SPACE.id},{client:c})).resolves.toMatchObject({status:'missing',generated:false});expect(c.embed).toHaveBeenCalledTimes(2);
});
it.each([false,true])('holds required model2 match/refusal holes instead of minting through old vectors (dismissed=%s)',async dismissed=>{
 const f=await person(),s=await signal(f.profileId),id=await source(f.profileId),policy=await readEmbeddingIndexPolicy(t.db,f.profileId),judge=vi.fn(async()=>({relation:'same' as const}));
 if(dismissed)await t.sql`UPDATE signals SET status='retired',dismissed_at=now() WHERE id=${s.id}`;
 await expect(t.db.transaction(tx=>applyCandidates(tx as never,{profileId:f.profileId,inspirationId:id,evidenceOwnerProfileId:f.profileId,embeddingModel:EMBEDDING_2_SPACE.id,embeddingPolicy:policy,candidates:[{statement:'I prefer busy mornings.',embedding:vector(),quote:null,quoteSource:null,reason:null,relatedEvidence:[]}],provider:{judgeSignalMatch:judge} as unknown as ModelProvider,preferredLocale:'en-US',now:new Date(),beforeWrites:async()=>{}}))).rejects.toMatchObject({code:'missing'});
 expect(judge).not.toHaveBeenCalled();expect(await t.sql`SELECT id FROM signals WHERE profile_id=${f.profileId}`).toHaveLength(1);
});
it.each([EMBEDDING_2_CANDIDATE_POLICY])('treats a high-cosine opposing claim as a judgment and preserves locked words (%s)',async thresholdPolicy=>{
 const f=await person(thresholdPolicy),s=await signal(f.profileId),id=await source(f.profileId),policy=await readEmbeddingIndexPolicy(t.db,f.profileId),judge=vi.fn(async()=>({relation:'opposed' as const}));
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:s.id,space:EMBEDDING_2_SPACE.id},{client:{model:EMBEDDING_2_SPACE.id,embed:async()=>vector()}});
 const result=await t.db.transaction(tx=>applyCandidates(tx as never,{profileId:f.profileId,inspirationId:id,evidenceOwnerProfileId:f.profileId,embeddingModel:EMBEDDING_2_SPACE.id,embeddingPolicy:policy,candidates:[{statement:'I prefer busy mornings.',embedding:vector(),quote:null,quoteSource:null,reason:null,relatedEvidence:[]}],provider:{judgeSignalMatch:judge} as unknown as ModelProvider,preferredLocale:'en-US',now:new Date(),beforeWrites:async()=>{}}));
 expect(judge).toHaveBeenCalledOnce();expect(result.mintedSignalIds).toHaveLength(1);expect(result.matchedSignalIds).toEqual([]);expect((await t.sql`SELECT statement,locked_at FROM signals WHERE id=${s.id}`)[0]).toMatchObject({statement:s.statement,locked_at:expect.any(String)});
 expect(await t.sql`SELECT id FROM signal_contradictions WHERE profile_id=${f.profileId}`).toHaveLength(1);
 const [kept]=await t.sql`SELECT input_hash FROM signal_embeddings WHERE signal_id=${result.mintedSignalIds[0]} AND model=${EMBEDDING_2_SPACE.id}`;expect(kept.input_hash).toBe(hashEmbedding2Input('I prefer busy mornings.','RETRIEVAL_DOCUMENT'));
});
it('captures policy in the existing generation query and refuses a changed epoch under the publication fence',async()=>{
 const f=await person(),before=await readGenerationRevision(t.db as never,{profileId:f.profileId});expect(before?.embeddingPolicy?.activeEpoch).toBe(1n);
 await t.sql`UPDATE profile_embedding_indexes SET active_epoch=2 WHERE profile_id=${f.profileId}`;
 await expect(t.db.transaction(tx=>assertGenerationRevision(tx as never,before!))).rejects.toThrow('Generation inputs changed');
});

it('uses the compiled candidate recall floor without a model-only policy shortcut',async()=>{
 const f=await person(EMBEDDING_2_CANDIDATE_POLICY),s=await signal(f.profileId);
 await indexEmbeddingSource(t.db,{profileId:f.profileId,sourceKind:'signal',sourceId:s.id,space:EMBEDDING_2_SPACE.id},{client:{model:EMBEDDING_2_SPACE.id,embed:async()=>vector()}});
 const r=recall(f,vi.fn(async()=>[.76,Math.sqrt(1-.76*.76),...Array<number>(766).fill(0)]));
 const result=await r.app.request('/recall?q=quiet%20mornings');expect(result.status).toBe(200);expect(await result.json()).toMatchObject({recall:{state:'ready',matches:[{signalId:s.id,locked:true}]}});expect(r.embed).toHaveBeenCalledOnce();
});
