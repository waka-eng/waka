/** Real selection/publication with prevalidated synthetic layer-2 fixtures.
 * Live models see only these fixtures; no deployment or historical repair. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {generationCalibrationCases as cases} from './generation-calibration-cases.js';
import {writeEvaluationSnapshot} from './evaluation-journal.js';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {createOpenRouterModelProvider} from '../../packages/api/src/lib/openrouter-model-provider.js';
import {OPENROUTER_GENERATION_MODEL} from '../../packages/api/src/lib/openrouter-http.js';
import {refreshTopOfMindForProfile,ShiftFloorHeldError} from '../../packages/api/src/lib/top-of-mind-synthesis.js';
import {loadPrincipleMaterial,refreshPrinciplesForProfile} from '../../packages/api/src/lib/principle-generation.js';
import {hashEmbeddingInput} from '../../packages/api/src/lib/inspiration-embeddings.js';
import type {ModelProvider} from '../../packages/api/src/lib/model-provider.js';
const digest=createHash('sha256').update(JSON.stringify(cases)).digest('hex');
if(process.argv.includes('--list')){console.log(JSON.stringify({count:cases.length,digest,cases},null,2));process.exit(0);}
const requested=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',');
if(requested)assert.ok(requested.length&&new Set(requested).size===requested.length&&requested.every(id=>cases.some(row=>row.id===id)));
const selectedCases=requested?cases.filter(row=>requested.includes(row.id)):cases;
const replayPath=process.argv.find(arg=>arg.startsWith('--replay='))?.slice(9);
const replay=replayPath?JSON.parse(await readFile(replayPath,'utf8')):null;
if(replay){assert.equal(replay.digest,digest);assert.equal(replay.finished,true);}
const overlayPath=process.argv.find(arg=>arg.startsWith('--overlay='))?.slice(10);
const overlay=overlayPath?JSON.parse(await readFile(overlayPath,'utf8')):null;
if(overlay){assert.ok(replay);assert.equal(overlay.digest,digest);assert.equal(overlay.finished,true);}
assert.ok(process.argv.includes('--live'),'Pass --live for synthetic generation requests');
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)??'baseline';assert.match(label,/^[a-z0-9-]+$/);
const url=new URL(process.env.DB_CONNECTION_URL??'');assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&/test|disposable/i.test(url.pathname));assert.equal(url.searchParams.has('options'),false);
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;delete process.env.AWS_LAMBDA_FUNCTION_NAME;
const env=parse(await readFile('/Users/agi/nextsteps/waka/.env.local','utf8'));assert.ok(env.OPENROUTER_API_KEY);
process.env.OPENROUTER_API_KEY=env.OPENROUTER_API_KEY;assert.equal(OPENROUTER_GENERATION_MODEL,'deepseek/deepseek-v4-flash-0731');
let calls=0,costUsd=0,stopped=false;const requests:Array<Record<string,unknown>>=[],journeys:Array<Record<string,any>>=[];
const caseContext=new AsyncLocalStorage<string>();
const concurrency=Number(process.argv.find(arg=>arg.startsWith('--concurrency='))?.slice(14)??'1');
assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=3);
const path=`work/generation-calibration/${label}-${Date.now()}.json`;
const implementationHashes=Object.fromEntries(await Promise.all(['packages/api/src/lib/top-of-mind-synthesis.ts','packages/api/src/queue/gemini.ts','packages/api/src/lib/principle-input.ts'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
const save=(finished=false)=>writeEvaluationSnapshot(path,{label,digest,replayPath:replayPath??null,overlayPath:overlayPath??null,matrixCount:cases.length,evaluatedIds:selectedCases.map(row=>row.id),implementationHashes,model:OPENROUTER_GENERATION_MODEL,calls,costUsd,maxCostUsd:.5,finished,requests,journeys});
save();const network=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);assert.equal(target.origin,'https://openrouter.ai');
  const body=JSON.parse(String(init?.body));assert.equal(body.model,OPENROUTER_GENERATION_MODEL);assert.ok(!stopped&&calls<120&&costUsd<.5);
  const row:Record<string,unknown>={caseId:caseContext.getStore(),phase:'dispatching',costUsd:null};requests.push(row);calls++;save();const start=performance.now();
  const response=await network(input,init),payload=await response.clone().json() as any,cost=payload.usage?.cost;
  Object.assign(row,{status:response.status,durationMs:Math.round(performance.now()-start),costUsd:cost??null,phase:'received'});
  if(!response.ok||typeof cost!=='number'||!Number.isFinite(cost)||cost<0){stopped=true;save();throw new Error('Unpriced or unsuccessful provider response');}
  costUsd+=cost;save();assert.ok(costUsd<=.5);return response;
};
const stableId=(text:string)=>{const h=createHash('sha256').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const now=new Date('2026-10-04T19:00:00Z'),day=86400000;
const real=createOpenRouterModelProvider();
const fixture=await createTestDatabase();
try{
  const runCase=async(item:typeof cases[number])=>{
    const accountId=stableId(item.id+':account'),profileId=stableId(item.id+':profile'),ids=new Map(item.signals.map(s=>[s.label,stableId(item.id+':'+s.label)]));
    await fixture.sql`INSERT INTO accounts(id,email) VALUES(${accountId},${item.id+'@calibration.example.test'})`;
    await fixture.sql`INSERT INTO profiles(id,account_id,type,name,preferred_locale) VALUES(${profileId},${accountId},'human','Synthetic calibration',${item.locale})`;
    await fixture.sql`INSERT INTO generation_revisions(profile_id) VALUES(${profileId}) ON CONFLICT DO NOTHING`;
    const sources:Array<{id:string;label:string}>=[];
    const themes=[...new Set(item.signals.map(s=>s.theme))];
    for(const signal of item.signals){
      const id=ids.get(signal.label)!,ages=signal.ages??[90,30,1];
      await fixture.sql`INSERT INTO signals(id,profile_id,statement,last_evidence_at) VALUES(${id},${profileId},${signal.correctedFrom??signal.statement},${new Date(now.getTime()-Math.min(...ages)*day).toISOString()}::timestamptz)`;
      for(const [index,age] of ages.entries()){
        const sourceId=stableId(item.id+':origin:'+(signal.sharedOrigin?'shared':signal.label)+':'+index);
        await fixture.sql`INSERT INTO inspirations(id,profile_id,text,kind,created_at) VALUES(${sourceId},${profileId},${signal.media?'':'Synthetic experience '+index+': '+signal.statement},${signal.media??'note'},${new Date(now.getTime()-age*day).toISOString()}::timestamptz) ON CONFLICT DO NOTHING`;
        if(signal.media)await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,content_type,size,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
          VALUES(${profileId},${sourceId},${signal.media},'https://example.test/synthetic','text/plain',100,'ready',${signal.media==='audio'?'audio_transcription':'image_description'},${signal.correctedFrom??signal.statement},${signal.media==='audio'?signal.statement:null})`;
        await fixture.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,material_revision)
          SELECT ${profileId},${profileId},${id},${sourceId},personal_revision FROM inspiration_revisions WHERE inspiration_id=${sourceId}`;
        sources.push({id:sourceId,label:signal.label});
      }
      if(signal.correctedFrom){await fixture.sql`UPDATE signals SET statement=${signal.statement} WHERE id=${id}`;await fixture.sql`UPDATE signal_evidence SET statement_revision=(SELECT statement_revision FROM signals WHERE id=${id}) WHERE signal_id=${id}`;}
      if((signal.status??'active')==='active')await fixture.sql`UPDATE signals SET status='active' WHERE id=${id}`;
      const vector=Array.from({length:768},(_,i)=>i===themes.indexOf(signal.theme)?1:0);
      await fixture.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding)
        VALUES(${profileId},${id},'calibration-fixture',768,${hashEmbeddingInput(signal.statement)},${JSON.stringify(vector)}::jsonb)`;
    }
    if(item.contradiction)await fixture.sql`INSERT INTO signal_contradictions(profile_id,a_signal_id,b_signal_id) VALUES(${profileId},${ids.get(item.contradiction[0])!},${ids.get(item.contradiction[1])!})`;
    if(item.previous){
      const [tom]=await fixture.sql`INSERT INTO top_of_minds(profile_id,created_at) VALUES(${profileId},${new Date(now.getTime()-(item.previous.ageHours??48)*3600000).toISOString()}::timestamptz) RETURNING id`;
      const [entry]=await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,belief,locked_at,pinned_at)
        VALUES(${tom.id},'pattern',${item.previous.body},${item.previous.body},${item.previous.locked?now.toISOString():null}::timestamptz,${item.previous.pinned?now.toISOString():null}::timestamptz) RETURNING id`;
      for(const name of item.previous.signalLabels)await fixture.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision)
        SELECT ${entry.id},id,statement_revision FROM signals WHERE id=${ids.get(name)!}`;
    }
    for(const signal of item.signals.filter(s=>s.deleted)){
      await fixture.sql`DELETE FROM inspirations WHERE id IN (SELECT inspiration_id FROM signal_evidence WHERE signal_id=${ids.get(signal.label)!})`;
      await fixture.sql`UPDATE signals SET status='retired',unsupported_at=now() WHERE id=${ids.get(signal.label)!}`;
    }
    // Layer-2 fixtures are prevalidated; no extraction/reembedding is evaluated.
    await fixture.sql`UPDATE background_jobs SET status='succeeded' WHERE profile_id=${profileId}`;
    const inputs:Record<string,unknown>={},outputs:Record<string,unknown>={};
    const recorded=overlay?.journeys.find((row:{id:string})=>row.id===item.id)??replay?.journeys.find((row:{id:string})=>row.id===item.id);
    if(replay)assert.ok(recorded,'Replay must contain every selected case');
    const request=async(name:string,input:unknown,call:()=>Promise<unknown>)=>{
      inputs[name]=input;
      if(recorded){
        const normalize=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,value)=>key==='lockedEntries'?value.map((row:{id:string})=>({...row,id:'opaque-current-entry'})):value));
        assert.deepEqual(normalize(input),normalize(recorded.inputs[name]),'Recorded response requires identical logical input');
      }
      const output=recorded?recorded.outputs[name]:await call();outputs[name]=output;return output;
    };
    const provider:ModelProvider={...real,
      synthesizeTopOfMind:async input=>request('topOfMind',input,()=>real.synthesizeTopOfMind(input)) as ReturnType<ModelProvider['synthesizeTopOfMind']>,
      distillPrinciples:async input=>request('principles',input,()=>real.distillPrinciples(input)) as ReturnType<ModelProvider['distillPrinciples']>,
      assessPrincipleGrounding:async input=>request('grounding',input,()=>real.assessPrincipleGrounding(input)) as ReturnType<ModelProvider['assessPrincipleGrounding']>};
    const start=performance.now();let reading:unknown=null,principles:unknown=null,held=false,error:string|null=null;
    try{reading=await refreshTopOfMindForProfile({profileId,reason:item.automatic?'signals_changed':'manual'},{db:fixture.db as never,modelProvider:provider,now});
      principles=await refreshPrinciplesForProfile({profileId},{db:fixture.db as never,modelProvider:provider,now});
    }catch(reason){if(reason instanceof ShiftFloorHeldError)held=true;else error=reason instanceof Error?reason.message:String(reason);}
    const entries=await fixture.sql`SELECT e.id,e.type,e.body,e.belief,e.locked_at,e.pinned_at,e.sort_order FROM top_of_mind_entries e JOIN top_of_minds m ON m.id=e.top_of_mind_id WHERE m.profile_id=${profileId} AND m.status='live' AND e.dismissed_at IS NULL ORDER BY e.sort_order,e.id`;
    const standing=await fixture.sql`SELECT id,statement,type,state,origin,locked_at FROM principles WHERE profile_id=${profileId} ORDER BY rank,id`;
    const material=await loadPrincipleMaterial(fixture.db as never,profileId);
    const selection=(inputs.topOfMind as {signals?:Array<{id:string}>}|undefined)?.signals??[];
    const selectedLabels=selection.map(row=>item.signals.find(s=>ids.get(s.label)===row.id)!.label);
    const lead=entries.find(row=>row.pinned_at)?.body??entries[0]?.body??null;
    const structural:string[]=[];
    if(error)structural.push('runtime error');if(Boolean(item.expected.held)!==held)structural.push('cadence hold');
    if(item.expected.principles==='none'&&standing.length)structural.push('unexpected principle');if(item.expected.principles==='some'&&!standing.length)structural.push('missing principle');
    if(item.expected.focus&&!([item.expected.focus].flat() as string[]).some(name=>selectedLabels.includes(name)))structural.push('missing current focus');
    if(item.expected.exactLead&&lead!==item.expected.exactLead)structural.push('human lead changed');
    if(item.expected.unchanged&&(reading as {reason?:string}|null)?.reason!=='no_change')structural.push('paraphrase churn');
    if(item.expected.maxDuplicateTheme&&selectedLabels.filter(name=>item.signals.find(s=>s.label===name)!.theme==='duplicate-tools').length>item.expected.maxDuplicateTheme)structural.push('duplicate dominance');
    if(JSON.stringify({entries,standing}).includes('WITHDRAWN_SENTINEL'))structural.push('deleted claim restored');
    const caseRequests=requests.filter(row=>row.caseId===item.id),caseCost=caseRequests.reduce((sum,row)=>sum+(typeof row.costUsd==='number'?row.costUsd:0),0);
    journeys.push({id:item.id,expected:item.expected,inputs,outputs,entries,standing,lead,reading,principles,held,error,structural,semanticReview:'pending',calls:caseRequests.length,costUsd:caseCost,durationMs:Math.round(performance.now()-start),
      trace:{sourceRevisions:await fixture.sql`SELECT inspiration_id,personal_revision::text FROM inspiration_revisions WHERE profile_id=${profileId}`,
        fixtureSignals:item.signals.map(s=>({id:ids.get(s.label),label:s.label,status:s.status??'active'})),independentEvidence:[...material.evidence.values()].map(row=>({signalId:row.signalId,units:row.evidenceAt.length,appearances:row.tomVersionIds.length})),selectedLabels,publication:reading,headline:lead,principleOutcome:principles}});
    journeys.sort((a,b)=>cases.findIndex(row=>row.id===a.id)-cases.findIndex(row=>row.id===b.id));
    save();console.log(JSON.stringify({id:item.id,calls:caseRequests.length,structural,principles:standing.map(row=>row.statement),lead}));
  };
  let next=0;
  const workers=await Promise.allSettled(Array.from({length:concurrency},async()=>{while(next<selectedCases.length&&!stopped){const item=selectedCases[next++]!;try{await caseContext.run(item.id,()=>runCase(item));}catch(error){stopped=true;throw error;}}}));
  const failed=workers.find(row=>row.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  console.log(JSON.stringify({path,calls,costUsd,journeys:journeys.length,structuralFailures:journeys.filter(row=>row.structural.length).map(row=>({id:row.id,reasons:row.structural}))}));
}finally{globalThis.fetch=network;await fixture.cleanup();save(true);}
if(journeys.length!==selectedCases.length||journeys.some(row=>row.structural.length))process.exitCode=1;
