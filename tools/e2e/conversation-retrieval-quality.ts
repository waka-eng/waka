/** Opt-in synthetic retrieval comparison. Replay cached vectors to compare
 * rank changes without buying the same embeddings again. No real account data. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {retrievalSources,retrievalCases,retrievalHoldoutCases,retrievalValidationCases,retrievalGate} from './conversation-retrieval-cases.js';
import {writeEvaluationSnapshot} from './evaluation-journal.js';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {ensureInspirationEmbedding,GEMINI_EMBEDDING_MODEL,GeminiEmbeddingHttpClient,type EmbeddingTaskType} from '../../packages/api/src/lib/inspiration-embeddings.js';
import {conversationSearchQuery} from '../../packages/api/src/lib/conversation-material.js';
import {readConversationContext} from '../../packages/api/src/lib/conversation-context.js';
const holdout=process.argv.includes('--holdout'),validation=process.argv.includes('--validation'),large=process.argv.includes('--large'),cases=validation?retrievalValidationCases:holdout?retrievalHoldoutCases:retrievalCases;
assert.ok(!(holdout&&validation),'Choose one comparison set');
const baseDigest=createHash('sha256').update(JSON.stringify({retrievalSources,retrievalCases,retrievalGate})).digest('hex');
const heldDigest=createHash('sha256').update(JSON.stringify({retrievalSources,retrievalCases:retrievalHoldoutCases,retrievalGate})).digest('hex');
const digest=holdout||validation?createHash('sha256').update(JSON.stringify({retrievalSources,retrievalCases:cases,retrievalGate})).digest('hex'):baseDigest;
if(process.argv.includes('--list')){console.log(JSON.stringify({digest,sources:retrievalSources.length,queries:cases.length,gate:retrievalGate,cases},null,2));process.exit(0);}
const live=process.argv.includes('--live'),cachedPath=process.argv.find(arg=>arg.startsWith('--cache='))?.slice(8);
assert.ok(live||cachedPath,'Pass --live or --cache=<saved-run>');
const connection=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['localhost','127.0.0.1'].includes(connection.hostname)&&/test|disposable/i.test(connection.pathname),'Use an explicit disposable loopback DB');
assert.equal(connection.searchParams.has('options'),false);
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;delete process.env.AWS_LAMBDA_FUNCTION_NAME;
if(live&&!process.env.GEMINI_API_KEY){const env=parse(await readFile('.env.local','utf8'));assert.ok(env.GEMINI_API_KEY);process.env.GEMINI_API_KEY=env.GEMINI_API_KEY;}
const previous=cachedPath?JSON.parse(await readFile(cachedPath,'utf8')):null;
if(previous){assert.ok([digest,baseDigest,heldDigest].includes(previous.digest));assert.equal(previous.model,GEMINI_EMBEDDING_MODEL);}
const cache:Record<string,number[]>={...previous?.cache};
const path=`work/retrieval-eval/run-${Date.now()}.json`,requests:Array<Record<string,unknown>>=[],results:Array<Record<string,any>>=[];
let estimatedUsd=0,newCalls=0,stopped=false;let benchmark:Record<string,unknown>|null=null;
const snapshot=(finished=false)=>writeEvaluationSnapshot(path,{digest,holdout,validation,large,benchmark,model:GEMINI_EMBEDDING_MODEL,live,cacheOrigin:cachedPath??null,newCalls,estimatedUsd,
  budgetReservationUsd:live?0.5:0,pricingSource:'https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/',
  pricingNote:'Estimate at published USD 0.15/M input tokens; UTF-8 bytes plus 1024 overhead per call conservatively estimate tokens. Not an invoice.',
  finished,requests,results,cache});
snapshot();
const network=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  assert.equal(url.origin,'https://generativelanguage.googleapis.com');
  assert.equal(url.pathname,`/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`);
  assert.ok(live&&!stopped&&newCalls<50,'Provider disabled or request cap reached');
  const body=JSON.parse(String(init?.body)),text=body.content.parts.map((part:{text:string})=>part.text).join('\n');
  const bytes=Buffer.byteLength(text,'utf8');assert.ok(bytes<=8000,'Synthetic input budget exceeded');
  const estimate=(bytes+1024)*.15/1e6;assert.ok(estimatedUsd+estimate<=.5);
  newCalls++;estimatedUsd+=estimate;const entry={phase:'dispatching',inputBytes:bytes,estimatedUsd:estimate,taskType:body.taskType} as Record<string,unknown>;
  requests.push(entry);snapshot();const start=performance.now();
  try{const response=await network(input,init);entry.status=response.status;entry.durationMs=Math.round(performance.now()-start);entry.phase='received';if(!response.ok)stopped=true;snapshot();return response;}
  catch(error){stopped=true;entry.phase='outcome_unknown';snapshot();throw error;}
};
const provider=new GeminiEmbeddingHttpClient(GEMINI_EMBEDDING_MODEL,{timeoutMs:5000,exchangeTimeoutMs:10000});
const client={model:GEMINI_EMBEDDING_MODEL,embed:async(text:string,taskType:EmbeddingTaskType='RETRIEVAL_DOCUMENT')=>{
  const key=createHash('sha256').update(taskType+'\n'+text).digest('hex');
  if(cache[key])return cache[key]!;assert.ok(live,'Cached vector is missing; no provider request allowed');
  const values=await provider.embed(text,taskType);cache[key]=values;snapshot();return values;
}};
const fixture=await createTestDatabase();
try{
  const person=async(email:string)=>{const [a]=await fixture.sql`INSERT INTO accounts(email) VALUES(${email}) RETURNING id`;const [p]=await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic retrieval fixture') RETURNING id`;return p.id as string;};
  const owner=await person('retrieval-owner@example.test'),foreign=await person('retrieval-foreign@example.test'),labels=new Map<string,string>();
  for(const [index,item] of retrievalSources.entries()){
    const profileId=item.foreign?foreign:owner;
    const [row]=await fixture.sql`INSERT INTO inspirations(profile_id,text,kind,created_at) VALUES(${profileId},${item.text},${item.media?.type??'note'},${new Date(Date.UTC(2026,8,1)+index*86400000).toISOString()}::timestamptz) RETURNING id`;
    labels.set(row.id,item.id);
    if(item.reflection)await fixture.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${profileId},${row.id},'What mattered here?',${item.reflection})`;
    if(item.media)await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,content_type,size,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
      VALUES(${profileId},${row.id},${item.media.type},'https://example.test/synthetic','text/plain',100,'ready',${item.media.type==='audio'?'audio_transcription':item.media.type==='image'?'image_description':'page_body'},${item.media.text},${item.media.correction??null})`;
    await ensureInspirationEmbedding({db:fixture.db as never,profileId,inspirationId:row.id,client});
  }
  if(large){
    assert.ok(!live,'Large-profile plumbing uses cached vectors, never extra provider calls');
    const [unrelated]=await fixture.sql`SELECT embedding FROM inspiration_embeddings WHERE profile_id=${foreign} LIMIT 1`;
    // Real-sized vector payloads, explicitly stale padding. This measures scan/
    // validation cost, not semantic quality for 5,000 independently embedded notes.
    await fixture.sql`WITH notes AS (INSERT INTO inspirations(profile_id,text,created_at)
      SELECT ${owner},'Synthetic archival filler ' || n,'2020-01-01'::timestamptz FROM generate_series(1,5000) n RETURNING id)
      INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding,updated_at)
      SELECT ${owner},id,${GEMINI_EMBEDDING_MODEL},'personal',768,'deliberately-stale-padding',${JSON.stringify(unrelated.embedding)}::jsonb,'2020-01-01'::timestamptz FROM notes`;
    await fixture.sql`ANALYZE inspiration_embeddings`;
    const plan=await fixture.sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT inspiration_id,embedding,input_hash FROM inspiration_embeddings
      WHERE profile_id=${owner} AND input_scope='personal' AND model=${GEMINI_EMBEDDING_MODEL} AND dimensions=768
      ORDER BY updated_at DESC,id DESC LIMIT 501`;
    benchmark={paddingNotes:5000,scanPlan:plan};
    assert.ok(JSON.stringify(plan).includes('inspiration_embeddings_profile_scope_recent_idx'),'Expected bounded-scan index');
  }
  for(const item of cases){
    const originalTerms=[...new Set(item.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].slice(0,8);
    let start=performance.now();
    const original=originalTerms.length?await fixture.sql<{id:string}[]>`SELECT id FROM inspirations WHERE profile_id=${owner}
      AND text ILIKE ANY(${originalTerms.map(term=>`%${term}%`)}::text[]) ORDER BY created_at DESC,id LIMIT 6`:[];
    const originalMs=performance.now()-start;
    const history=[...(item.prior?[{role:'user',content:item.prior}]:[]),{role:'user',content:item.query}],query=conversationSearchQuery(history);
    start=performance.now();const lexical=await readConversationContext(fixture.db as never,owner,query);const lexicalMs=performance.now()-start;
    start=performance.now();const vector=await client.embed(query,'RETRIEVAL_QUERY');const embeddingMs=performance.now()-start;
    let trace:unknown;
    start=performance.now();const hybrid=await readConversationContext(fixture.db as never,owner,query,undefined,undefined,vector,value=>{trace=value;});const hybridMs=performance.now()-start;
    const describe=(rows:Array<{id:string}>)=>{const selected=rows.map(row=>labels.get(row.id)??'UNKNOWN');return {selected,hit:item.required.some(id=>selected.includes(id)),unexpected:selected.filter(id=>!item.allowed.includes(id)),leaked:selected.includes('foreign')||selected.includes('UNKNOWN')};};
    results.push({id:item.id,query:item.query,positive:item.required.length>0,semanticTarget:Boolean(item.semanticTarget),original:describe(original),lexical:describe(lexical.inspirations),hybrid:describe(hybrid.inspirations),originalMs,lexicalMs,embeddingMs,hybridMs,trace});snapshot();
    console.log(JSON.stringify(results.at(-1)));
  }
  const positive=results.filter(row=>row.positive),semantic=results.filter(row=>row.semanticTarget),negative=results.filter(row=>!row.positive);
  const scores=Object.fromEntries(['original','lexical','hybrid'].map(mode=>[mode,{hits:positive.filter(row=>row[mode].hit).length,total:positive.length,
    unexpected:results.reduce((sum,row)=>sum+row[mode].unexpected.length,0),negativeMatches:negative.reduce((sum,row)=>sum+row[mode].selected.length,0)}]));
  const gain=semantic.filter(row=>row.hybrid.hit).length-semantic.filter(row=>row.lexical.hit).length;
  const passed=scores.hybrid!.hits/positive.length>=retrievalGate.minimumRecall&&scores.hybrid!.hits>=scores.lexical!.hits&&gain>=retrievalGate.minimumSemanticGain
    &&scores.hybrid!.negativeMatches<=retrievalGate.maximumNegativeMatches&&scores.hybrid!.unexpected<=scores.lexical!.unexpected&&!results.some(row=>row.hybrid.leaked);
  const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]!;
  const latency={lexicalMedianMs:percentile(results.map(row=>row.lexicalMs),.5),hybridMedianMs:percentile(results.map(row=>row.hybridMs),.5),hybridP95Ms:percentile(results.map(row=>row.hybridMs),.95),embeddingMedianMs:percentile(results.map(row=>row.embeddingMs),.5)};
  const performancePassed=!large||latency.hybridP95Ms<=1000;
  console.log(JSON.stringify({path,scores,semanticGain:gain,passed:passed&&performancePassed,latency,newCalls,estimatedUsd}));
  results.push({summary:{scores,semanticGain:gain,passed:passed&&performancePassed,latency}});if(!passed||!performancePassed)process.exitCode=1;
}finally{globalThis.fetch=network;await fixture.cleanup();snapshot(true);}
