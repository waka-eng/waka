/** Four paid synthetic history checks through the real owned context reader.
 * No deployed accounts, raw user content, embeddings or schema updates. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {readConversationContext,conversationPromptSources} from '../../packages/api/src/lib/conversation-context.js';
import {createOpenRouterModelProvider} from '../../packages/api/src/lib/openrouter-model-provider.js';
import {writeEvaluationSnapshot} from './evaluation-journal.js';
assert.ok(process.argv.includes('--live'));
const target=new URL(process.env.DB_CONNECTION_URL??'');assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&/test|disposable/i.test(target.pathname)&&!target.searchParams.has('options'));
const model='deepseek/deepseek-v4.1-flash';process.env.WAKA_MODEL_CHAT=model;
assert.ok(process.env.OPENROUTER_API_KEY,'Set OPENROUTER_API_KEY explicitly; this evaluator loads no env file.');
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
const path=`work/conversation-eval/history-${Date.now()}.json`,requests:Array<Record<string,unknown>>=[],results:Array<Record<string,unknown>>=[];
let calls=0,costUsd=0,stopped=false;const network=globalThis.fetch;
const save=(finished=false)=>writeEvaluationSnapshot(path,{model,calls,costUsd,maxCalls:4,maxCostUsd:.1,costComplete:requests.every(row=>typeof row.costUsd==='number'),finished,requests,results});
save();
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),body=JSON.parse(String(init?.body));
  assert.equal(url.origin,'https://openrouter.ai');assert.equal(body.model,model);assert.equal(body.max_tokens,1200);assert.ok(!stopped&&calls<4&&costUsd<.1);
  const row:Record<string,unknown>={phase:'dispatching',costUsd:null};requests.push(row);calls++;save();
  try{const start=performance.now(),response=await network(input,init),data=await response.clone().json() as {usage?:{cost?:number}};
    Object.assign(row,{status:response.status,durationMs:Math.round(performance.now()-start),phase:'received',costUsd:data.usage?.cost??null});
    if(!response.ok||typeof data.usage?.cost!=='number'){stopped=true;save();throw new Error('Unpriced or failed provider response');}
    costUsd+=data.usage.cost;save();assert.ok(costUsd<=.1);return response;
  }catch(error){stopped=true;save();throw error;}
};
const cases=[
  {name:'comparison-en',locale:'en-US' as const,old:'I prefer a detailed plan before starting.',current:'I try a small experiment before a detailed plan.',question:'What has changed in how I think?',expectation:'Compare dated recorded wording, cite both records, do not assert a changed identity or exact belief-change date.',past:true},
  {name:'comparison-ko',locale:'ko-KR' as const,old:'시작하기 전에 계획을 자세히 세운다.',current:'계획을 확정하기 전에 작은 실험을 해 본다.',question:'내 생각은 어떻게 달라졌나요?',expectation:'Natural Korean comparison of dated records without invented motives or certainty.',past:true},
  {name:'missing-earlier',locale:'en-US' as const,old:'',current:'I leave room for a small experiment.',question:'How has my thinking changed since last year?',expectation:'Abstain from a before/after comparison when no earlier record is supplied; do not claim the whole archive has no history.',past:false},
  {name:'withheld-earlier',locale:'en-US' as const,old:'WITHHELD_HISTORY_SENTINEL',current:'I leave room for a small experiment.',question:'What has changed in how I think?',expectation:'Missing unsupported and foreign history never becomes a reconstructed earlier belief.',past:false},
];
const fixture=await createTestDatabase();
try{
  for(const item of cases){
    await fixture.truncateAll();const [a]=await fixture.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
    const [p]=await fixture.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES(${a.id},'human','Synthetic history',${item.locale}) RETURNING id`;
    if(item.old){const [old]=await fixture.sql`INSERT INTO top_of_minds(profile_id,version,status,created_at) VALUES(${p.id},1,'superseded','2026-09-01T12:00:00Z') RETURNING id`;
      await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${old.id},'pattern',${item.old},${item.past?'2026-09-01T12:00:00Z':null}::timestamptz)`;}
    const [current]=await fixture.sql`INSERT INTO top_of_minds(profile_id,version,status,created_at) VALUES(${p.id},2,'live','2026-10-01T12:00:00Z') RETURNING id`;
    await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${current.id},'pattern',${item.current},'2026-10-01T12:00:00Z')`;
    const [other]=await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'agent','Foreign to this stack') RETURNING id`;
    const [foreign]=await fixture.sql`INSERT INTO top_of_minds(profile_id,version,status) VALUES(${other.id},1,'superseded') RETURNING id`;
    await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${foreign.id},'pattern','FOREIGN_HISTORY_SENTINEL',now())`;
    const context=await readConversationContext(fixture.db as never,p.id,item.question),sources=conversationPromptSources([...context.principles,...context.reading,...context.inspirations]);
    assert.equal(sources.some(source=>source.historical),item.past);assert.ok(!JSON.stringify(sources).includes('SENTINEL'));
    let output:unknown=null,error:string|null=null;try{output=await createOpenRouterModelProvider().answerConversation({preferredLocale:item.locale,messageDate:'2026-10-05',history:[{role:'user',content:item.question}],sources});}catch(reason){error=reason instanceof Error?reason.message:String(reason);}
    results.push({name:item.name,expectation:item.expectation,sources,output,error,semanticReview:'pending'});save();if(stopped)break;
  }
}finally{globalThis.fetch=network;await fixture.cleanup();save(true);}
console.log(JSON.stringify({path,calls,costUsd,results}));
if(results.length!==4||results.some(row=>row.error))process.exitCode=1;
