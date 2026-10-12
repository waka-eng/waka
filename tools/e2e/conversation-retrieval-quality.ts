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
import type {ConversationReference} from '../../packages/api/src/db/schema-conversations.js';
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
  /* ═══ THE HYBRID ARM, CALLED BY NAME ══════════════════════════════════
   *
   * SECURITY REVIEW 2026-10-11, FINDING 8. `readConversationContext` gained
   * `initialInspirationId` as a new POSITIONAL parameter between
   * `initialPrincipleId` and `queryVector`. Every caller inside
   * `packages/api` was updated — `conversation-retrieval.db.test.ts:38`
   * correctly gained its sixth `undefined` — and this one was not. So
   * `vector` (a `number[]`) landed in the `initialInspirationId` slot and
   * the trace callback landed in `queryVector`.
   *
   * THE REVIEW PREDICTED THIS WOULD REPORT LEXICAL NUMBERS UNDER THE
   * `hybrid` KEY. It does not, and the real behaviour is worth recording
   * because it is why nobody noticed either way. `conversation-retrieval.ts:44`
   * validates the vector — `queryVector.length!==GEMINI_EMBEDDING_DIMENSIONS`
   * — and a function's `.length` is its ARITY, 1, so the stale call throws
   * `Invalid conversation query vector` four frames down. Measured against
   * the local test database on 2026-10-11 with a fabricated 768-float
   * vector, both calls side by side: the stale one threw and no trace
   * arrived; the corrected one returned and the trace arrived.
   *
   * So this harness ABORTS rather than lying, which is better than the
   * review feared and still bad. The message names the vector, the vector
   * is fine, and the fault is six parameters away at the call site — and it
   * means nobody has run this gate since `initialInspirationId` was
   * inserted, or that abort would have been reported. The silent-degrade
   * reading stays worth defending against anyway: it is what happens the
   * moment the mislanded argument is a `string|null` rather than an array,
   * which is the next shape this family of parameters will take.
   *
   * WHY NOTHING CAUGHT IT. `packages/api/tsconfig.json` is
   * `"include": ["src/**\/*.ts"]` and no package typechecks `tools/`, so
   * the type mismatch never reached `tsc`. Six optional positional
   * parameters and no typecheck is the whole mechanism, and inserting the
   * missing `undefined` fixes today's call while leaving the mechanism
   * intact for the seventh parameter.
   *
   * SO THE POSITIONS ARE WRITTEN ONCE, HERE. Both call sites below pass
   * named fields; this shim is the only place in this file that knows the
   * order, and it is three lines above the assertion that checks it. The
   * upstream fix is an options object for the last four parameters of
   * `readConversationContext` itself — that belongs in `packages/api` with
   * its own callers and tests, and is not this file's to make.
   *
   * REJECTED: just adding the `undefined` and moving on. It is the smallest
   * diff and the review's own suggested fix, and it leaves the mechanism in
   * place with a message that points at the wrong thing. A quality gate
   * that stops measuring — or stops with an accusation against an innocent
   * argument — is worse than no gate, because the number it prints will be
   * believed and the stack trace it prints will be chased.
   */
  assert.equal(readConversationContext.length,8,
    'readConversationContext no longer takes 8 parameters, so the positional mapping in readContext() below is stale. '+
    'Re-read its signature and fix the shim before trusting any number this harness prints.');
  const readContext=(args:{question:string,referenceIds?:ConversationReference[],initialPrincipleId?:string|null,initialInspirationId?:string|null,queryVector?:number[],onRetrievalTrace?:(trace:unknown)=>void})=>
    readConversationContext(fixture.db as never,owner,args.question,args.referenceIds,args.initialPrincipleId,args.initialInspirationId,args.queryVector,args.onRetrievalTrace as never);
  for(const item of cases){
    const originalTerms=[...new Set(item.query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].slice(0,8);
    let start=performance.now();
    const original=originalTerms.length?await fixture.sql<{id:string}[]>`SELECT id FROM inspirations WHERE profile_id=${owner}
      AND text ILIKE ANY(${originalTerms.map(term=>`%${term}%`)}::text[]) ORDER BY created_at DESC,id LIMIT 6`:[];
    const originalMs=performance.now()-start;
    const history=[...(item.prior?[{role:'user',content:item.prior}]:[]),{role:'user',content:item.query}],query=conversationSearchQuery(history);
    start=performance.now();const lexical=await readContext({question:query});const lexicalMs=performance.now()-start;
    start=performance.now();const vector=await client.embed(query,'RETRIEVAL_QUERY');const embeddingMs=performance.now()-start;
    let trace:unknown;
    start=performance.now();const hybrid=await readContext({question:query,queryVector:vector,onRetrievalTrace:value=>{trace=value;}});const hybridMs=performance.now()-start;
    /* AND IT ACTUALLY RAN HYBRID. The trace callback fires from exactly one
       place — inside `if(queryVector&&!referenceIds)`, right after
       `readSemanticConversationCandidates` — so an absent trace means the
       embedding arm did not execute and `hybrid` is lexical wearing the
       hybrid label. It is the only check here that does not depend on the
       arguments being spelled correctly — it observes the behaviour rather
       than the call — and it is what makes the arity guard above more than
       a guess: a signature can keep its eight parameters and still reorder
       them. Loud and immediate, because every number computed below this
       line is otherwise a quiet lie. */
    assert.ok(trace,`Hybrid retrieval produced no trace for case ${item.id}, so the embedding arm never ran and `+
      'the "hybrid" column below would report lexical results. Check the arguments handed to readContext().');
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
