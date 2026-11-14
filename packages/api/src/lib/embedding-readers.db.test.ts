/** WHAT THIS MOCKS, AND WHY (gate G6): `ModelProvider` is a deterministic
 * judge recording which synthetic pairs reach it. Real PostgreSQL17 schemas,
 * production readers, hashes and tenant constraints run without provider HTTP. */
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {hashEmbeddingInput,GEMINI_EMBEDDING_MODEL,buildCanonicalInspirationEmbeddingInput,ensureInspirationEmbedding} from './inspiration-embeddings.js';
import {tendSignalGarden} from './signal-gardener.js';
import {reembedSignalStatement} from './signal-embeddings.js';
import {deriveSignalsForInspiration} from './signal-derivation.js';
import type {ModelProvider,SignalCandidateExtractionInput} from './model-provider.js';
import {createRecallRoutes} from '../routes/recall.js';
import type {AuthEnv} from './middleware.js';

let t:TestDatabase,sequence=0;
beforeAll(async()=>{t=await createTestDatabase();});
afterAll(async()=>{await t?.cleanup();});
const vector=()=>[1,...Array<number>(767).fill(0)];
async function fixture(mode:'current'|'foreign_space'|'stale_hash'|'wrong_dimensions'|'wrong_length'){
 const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${`embedding-reader-${++sequence}@example.test`}) RETURNING id`;
 const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Synthetic owner') RETURNING id`;
 const rows=await t.sql`INSERT INTO signals(profile_id,statement,status,locked_at) VALUES
   (${profile.id},'I protect quiet time.','emerging',now()),(${profile.id},'I preserve room to think.','emerging',now()) RETURNING id,statement`;
 for(const [i,row] of rows.entries()){
  const model=i===1&&mode==='foreign_space'?'openrouter:google/gemini-embedding-001:unverified':GEMINI_EMBEDDING_MODEL;
  const hash=i===1&&mode==='stale_hash'?hashEmbeddingInput('Previous statement'):hashEmbeddingInput(row.statement);
  const values=mode==='wrong_length'?[1,0,0]:vector();
  await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding)
    VALUES(${profile.id},${row.id},${model},${mode==='wrong_dimensions'?3:768},${hash},${JSON.stringify(values)}::jsonb)`;
 }
 const calls:Array<{candidateStatement:string;existingStatement:string}>=[];
 const provider={judgeSignalMatch:async(input:{candidateStatement:string;existingStatement:string})=>{calls.push(input);return {relation:'independent' as const};}} as unknown as ModelProvider;
 return {profileId:profile.id as string,accountId:account.id as string,rows,calls,provider};
}
it.each(['foreign_space','stale_hash','wrong_dimensions','wrong_length'] as const)('does not compare %s vectors in the native gardener space',async mode=>{
 const f=await fixture(mode);await tendSignalGarden(t.db as never,{profileId:f.profileId,preferredLocale:'en-US',provider:f.provider});
 expect(f.calls).toEqual([]);
 expect((await t.sql`SELECT statement,locked_at FROM signals WHERE profile_id=${f.profileId}`).every(row=>row.locked_at)).toBe(true);
});
it('still compares valid native current vectors and preserves owner-locked wording',async()=>{
 const f=await fixture('current');await tendSignalGarden(t.db as never,{profileId:f.profileId,preferredLocale:'en-US',provider:f.provider});
 expect(f.calls).toHaveLength(1);
 expect((await t.sql`SELECT statement FROM signals WHERE profile_id=${f.profileId} ORDER BY statement`).map(row=>row.statement)).toEqual(f.rows.map(row=>row.statement).sort());
});
it('keeps current native memory readable but reports held query transport instead of false empty recall',async()=>{
 const f=await fixture('current');const network=vi.fn(()=>{throw Error('Unexpected network');});
 vi.stubEnv('WAKA_EMBEDDING_PROVIDER','openrouter');vi.stubGlobal('fetch',network);
 try{
  await tendSignalGarden(t.db as never,{profileId:f.profileId,preferredLocale:'en-US',provider:f.provider});expect(f.calls).toHaveLength(1);
  const app=new Hono<AuthEnv>();app.route('/recall',createRecallRoutes({getDatabase:()=>t.db as never,authMiddleware:async(c,next)=>{
   c.set('session',{sessionId:'keeper-key:'+randomUUID(),keyScoped:true,keeperAccess:'read_only',account:{id:f.accountId,email:'fixture@example.test'},profile:{id:f.profileId,accountId:f.accountId,type:'human',name:'Owner',preferredLocale:'en-US'}});await next();
  }}));
  const response=await app.request('/recall?q=quiet');expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({reason:'compatibility_held',recall:{state:'unavailable'}});
  expect(network).not.toHaveBeenCalled();expect(await t.sql`SELECT account_id FROM account_recall_limits WHERE account_id=${f.accountId}`).toHaveLength(0);
  expect((await t.sql`SELECT count(*)::int AS n FROM consultations WHERE profile_id=${f.profileId}`)[0]!.n).toBe(1);
  expect(await t.sql`SELECT id FROM signals WHERE profile_id=${f.profileId}`).toHaveLength(2);
 }finally{vi.unstubAllEnvs();vi.unstubAllGlobals();}
});
it('repairs an invalid current-hash cache only after a valid current vector is available',async()=>{
 const f=await fixture('current'),source=f.rows[0]!;
 const [before]=await t.sql`SELECT locked_at FROM signals WHERE id=${source.id}`;
 await t.sql`UPDATE signal_embeddings SET dimensions=3 WHERE signal_id=${source.id}`;
 const embed=vi.fn(async()=>vector());
 await reembedSignalStatement(t.db as never,{profileId:f.profileId,signalId:source.id,statement:source.statement},{embeddingClient:{model:GEMINI_EMBEDDING_MODEL,dimensions:768,embed}});
 expect(embed).toHaveBeenCalledOnce();expect((await t.sql`SELECT dimensions,input_hash FROM signal_embeddings WHERE signal_id=${source.id}`)[0]).toEqual({dimensions:768,input_hash:hashEmbeddingInput(source.statement)});
 expect((await t.sql`SELECT statement,locked_at FROM signals WHERE id=${source.id}`)[0]).toEqual({statement:source.statement,locked_at:before!.locked_at});
});
it('repairs an invalid inspiration cache without changing canonical bytes or creating a foreign namespace',async()=>{
 const f=await fixture('current');
 const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},'I preserve quiet time.\r\n') RETURNING id,text`;
 const client={model:GEMINI_EMBEDDING_MODEL,dimensions:768,embed:vi.fn(async()=>vector())};
 const before=await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:source.id,client});
 await t.sql`UPDATE inspiration_embeddings SET dimensions=3 WHERE inspiration_id=${source.id}`;
 client.embed.mockClear();
 const after=await ensureInspirationEmbedding({db:t.db as never,profileId:f.profileId,inspirationId:source.id,client});
 expect(after.generated).toBe(true);expect(client.embed).toHaveBeenCalledOnce();expect(after.inputHash).toBe(before.inputHash);
 expect(after.embedding?.dimensions).toBe(768);expect(after.embedding?.model).toBe(GEMINI_EMBEDDING_MODEL);
 expect((await t.sql`SELECT text FROM inspirations WHERE id=${source.id}`)[0]!.text).toBe(source.text);
});
it('proves the selected recurrence inputs against current canonical text and reflections in one bounded statement',async()=>{
 const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${`recurrence-${++sequence}@example.test`}) RETURNING id`;
 const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Owner') RETURNING id`;
 const inputs:SignalCandidateExtractionInput[]=[];
 const provider={extractSignalCandidates:async(input:SignalCandidateExtractionInput)=>{inputs.push(input);return {statements:[]};}} as unknown as ModelProvider;
 const seed=async(text:string,options:{model?:string;dimensions?:number;oldText?:string;answer?:string;excluded?:boolean}={})=>{
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text,memory_excluded_at) VALUES(${profile.id},${text},${options.excluded?new Date().toISOString():null}) RETURNING id`;
  if(options.answer)await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${profile.id},${row.id},'Why?',${options.answer})`;
  const canonical=buildCanonicalInspirationEmbeddingInput({text:options.oldText??text,kind:null,
    reflections:options.answer?[{question:'Why?',answer:options.answer,skipped:false,createdAt:new Date()}]:[]});
  await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding) VALUES
    (${profile.id},${row.id},${options.model??GEMINI_EMBEDDING_MODEL},'personal',${options.dimensions??768},${hashEmbeddingInput(canonical)},${JSON.stringify(vector())}::jsonb)`;
  return row.id as string;
 };
 const primary=await seed('Today I protect quiet time.');
 const valid=await seed('Earlier I left room to think.',{answer:'Quiet time helps.'});
 await seed('Different current wording.',{oldText:'Earlier wording.'});
 const edited=await seed('A reflective capture.',{answer:'Previous answer.'});await t.sql`UPDATE reflections SET answer='Current answer.' WHERE inspiration_id=${edited}`;
 await seed('Wrong metadata.',{dimensions:3});await seed('Other vector space.',{model:'openrouter:google/gemini-embedding-001:unverified'});await seed('Excluded source.',{excluded:true});
 const embed=vi.fn(async()=>vector());
 const options=(t.sql as unknown as {options:{debug?:unknown}}).options,prior=options.debug;let currentMaterialStatements=0;
 options.debug=(_connection:unknown,query:string)=>{if(query.includes('jsonb_agg(jsonb_build_object')&&query.includes('"reflections"')&&query.includes('"inspirations"'))currentMaterialStatements++;};
 let result:Awaited<ReturnType<typeof deriveSignalsForInspiration>>;
 try{result=await deriveSignalsForInspiration({inspirationId:primary,reason:'created'},{db:t.db as never,modelProvider:provider,embeddingClient:{model:GEMINI_EMBEDDING_MODEL,dimensions:768,embed}});}
 finally{options.debug=prior;}
 expect(currentMaterialStatements).toBe(1);
 expect(result.status).toBe('no_candidates');expect(embed).not.toHaveBeenCalled();expect(inputs).toHaveLength(1);
 expect(inputs[0]!.relatedInspirations.map(row=>row.id)).toEqual([valid]);
 expect(inputs[0]!.relatedInspirations[0]!.text).toBe('Earlier I left room to think.');
});
