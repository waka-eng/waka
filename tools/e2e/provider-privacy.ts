/** One explicit synthetic routing probe, not a provider retention audit. */
import assert from 'node:assert/strict';
import {writeEvaluationSnapshot} from './evaluation-journal.js';
import {callOpenRouter} from '../../packages/api/src/lib/openrouter-http.js';
assert.ok(process.argv.includes('--live'),'Pass --live for one paid synthetic call');
assert.ok(process.env.OPENROUTER_API_KEY,'Supply the approved evaluation key explicitly');
process.env.WAKA_OPENROUTER_DATA_COLLECTION='deny';process.env.WAKA_OPENROUTER_REQUIRE_ZDR='1';
const model='deepseek/deepseek-v4.1-flash-1017',path=`work/conversation-eval/privacy-${Date.now()}.json`;
const network=globalThis.fetch,requests:Array<Record<string,unknown>>=[];
let costUsd=0,output:unknown=null,error:string|null=null;
const save=(finished=false)=>writeEvaluationSnapshot(path,{model,maxCalls:1,maxCostUsd:.1,calls:requests.length,costUsd,
  costComplete:requests.every(row=>typeof row.costUsd==='number'),finished,requests,output,error,
  scope:'Synthetic routing availability only, not proof of contractual retention, account settings or deployed configuration'});
save();globalThis.fetch=async(input,init)=>{
  assert.equal(String(input),'https://openrouter.ai/api/v1/chat/completions');assert.equal(requests.length,0);
  const body=JSON.parse(String(init?.body));assert.equal(body.model,model);assert.deepEqual(body.provider,{data_collection:'deny',zdr:true});assert.equal(body.max_tokens,200);
  const row:Record<string,unknown>={costUsd:null,phase:'dispatching'};requests.push(row);save();
  const response=await network(input,init),data=await response.clone().json() as any;
  row.phase='received';row.status=response.status;row.costUsd=typeof data.usage?.cost==='number'&&Number.isFinite(data.usage.cost)&&data.usage.cost>=0?data.usage.cost:null;
  row.provider=typeof data.provider==='string'&&/^[A-Za-z0-9 ._-]{1,80}$/.test(data.provider)?data.provider:null;
  row.model=data.model===model?model:'unexpected';if(typeof row.costUsd==='number')costUsd=row.costUsd;
  save();assert.ok(response.ok&&typeof row.costUsd==='number','Failed or unpriced response');
  assert.equal(row.model,model,'Unexpected returned model');assert.ok(costUsd<=.1);save();return response;
};
try{output=await callOpenRouter({model,messages:[{role:'system',content:'Return only a JSON object with ok:true.'},{role:'user',content:'Synthetic availability test. No personal information.'}],max_tokens:200,reasoning:{enabled:false},response_format:{type:'json_object'}},'privacy probe');assert.deepEqual(output,{ok:true});}
catch(reason){error=reason instanceof Error?reason.message:'Probe failed';}
finally{globalThis.fetch=network;save(true);}
console.log(JSON.stringify({path,costUsd,requests,output,error}));if(error)process.exitCode=1;
