/** Opt-in raw-input -> real worker -> reading/chat evaluation, synthetic only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {createTestDatabase} from '../../packages/api/test/helpers/db';
import {buildArticleHtml,renderTextPng,FIXTURE_ARTICLE_MARKER,FIXTURE_ARTICLE_BOILERPLATE_MARKER} from './fixture-server';

assert.ok(process.argv.includes('--live'));
const configured=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(configured.hostname)&&/test|disposable/i.test(configured.pathname));
assert.equal(configured.searchParams.has('options'),false);
const credentials=parse(await readFile(process.env.WAKA_EVALUATION_ENV_FILE??'.env.local','utf8'));
assert.ok(credentials.OPENROUTER_API_KEY?.trim()&&credentials.GEMINI_API_KEY?.trim());
process.env.OPENROUTER_API_KEY=credentials.OPENROUTER_API_KEY;process.env.GEMINI_API_KEY=credentials.GEMINI_API_KEY;
process.env.NODE_ENV='test';process.env.JWT_SECRET='raw-quality-synthetic-session-only';
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';process.env.WAKA_CONVERSATION_REPLIES='1';
for(const key of ['WAKA_BACKGROUND_WORKER_FUNCTION','AWS_LAMBDA_FUNCTION_NAME'])delete process.env[key];
for(const key of ['WAKA_MODEL_EXTRACT','WAKA_MODEL_TOM','WAKA_MODEL_CHAT','WAKA_MODEL_SUPPORT'])process.env[key]='deepseek/deepseek-v4.1-flash';
const cases=[
  {id:'text-en',locale:'en-US',type:'text',text:'I kept one morning unplanned last weekend; the space helped me start a sketch. I want to try that again.',question:'How could I try leaving room for sketching next weekend?'},
  {id:'text-ko',locale:'ko-KR',type:'text',text:'지난 주말에는 오전을 비워 두고 그림을 시작해 봤어요. 이번 달에만 한 번 더 해보고 싶어요.',question:'이번 달에만 한 번 더 시도할 때 무엇을 살펴보면 좋을까요?'},
  {id:'link-en',locale:'en-US',type:'link',text:'I saved this article to inspect its argument. I have not decided whether I agree with it.',question:'Does saving this article mean I agree with its argument?'},
  {id:'link-ko',locale:'ko-KR',type:'link',text:'이 글의 주장을 살펴보려고 저장했어요. 동의할지는 아직 정하지 않았어요.',question:'이 글을 저장했다고 해서 그 주장에 동의하는 건가요?'},
  {id:'image-en',locale:'en-US',type:'image',text:'The phrase in this image makes me want to leave breathing room in this week’s plans.',question:'What is a small way to try leaving room in this week’s plans?'},
  {id:'image-ko',locale:'ko-KR',type:'image',text:'사진 속 문구처럼, 이번 주 계획에 여백을 남겨 보고 싶어요.',question:'이번 주 계획에 여백을 조금 남겨 보려면 어떻게 시작하면 좋을까요?'},
  {id:'audio-en',locale:'en-US',type:'audio',text:'',clip:'english',question:'What did I say I wanted to try next week?'},
  {id:'audio-ko',locale:'ko-KR',type:'audio',text:'',clip:'korean',question:'녹음에서 다음 주에 무엇을 해보고 싶다고 했나요?'},
  {id:'silence',locale:'en-US',type:'audio',text:'',clip:'silence',question:'What does this silent recording tell you about my preferences?'},
] as const;
const digest=createHash('sha256').update(JSON.stringify(cases)).digest('hex');
const ids=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',');
assert.ok(!ids||ids.every(id=>cases.some(item=>item.id===id))&&new Set(ids).size===ids.length);
const selected=ids?cases.filter(item=>ids.includes(item.id)):cases;
const maxCostUsd=Number(process.argv.find(arg=>arg.startsWith('--max-cost='))?.slice(11)??'.5');assert.ok(maxCostUsd>0&&maxCostUsd<=.5);
const maxCalls=Math.min(96,selected.length*12);
const files=new Map<string,Buffer>(),image=renderTextPng('LEAVE SOME SPACE');
const server=createServer((request,response)=>{
  const path=new URL(request.url??'/','http://127.0.0.1').pathname;
  const bytes=path==='/article'?Buffer.from(buildArticleHtml()):path==='/image.png'?image:files.get(path);
  if(!bytes){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':path==='/article'?'text/html':path==='/image.png'?'image/png':'audio/wav','Content-Length':bytes.length});
  response.end(request.method==='HEAD'?undefined:bytes);
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS=`127.0.0.1:${address.port}`;
process.env.ATTACHMENTS_BUCKET='raw-quality';process.env.ATTACHMENTS_ENDPOINT=origin;
const fixture=await createTestDatabase();configured.searchParams.set('options',`-c search_path=${fixture.schemaName}`);process.env.DB_CONNECTION_URL=configured.toString();
const {getDb}=await import('../../packages/api/src/lib/db');
const {enqueueEnrichAttachment,enqueueDeriveSignals,runBackgroundJobWorker}=await import('../../packages/api/src/lib/queue');
const {app}=await import('../../packages/api/src/index');
const {signSessionToken}=await import('../../packages/api/src/lib/auth');
const {createSessionRow}=await import('../../packages/api/src/lib/session');
const output=ids?'work/web-quality/raw-inputs-remainder.json':'work/web-quality/raw-inputs.json',network=globalThis.fetch;
await mkdir('work/web-quality',{recursive:true});
let current='setup',calls=0,reportedCostUsd=0,geminiUpperEstimateUsd=0,stopped=false;
const attempts:Array<Record<string,unknown>>=[],results:unknown[]=[];
const persist=(finished=false)=>writeFile(output,JSON.stringify({digest,cases,evaluatedIds:selected.map(item=>item.id),maxCalls,maxCostUsd,calls,reportedCostUsd,geminiUpperEstimateUsd,stopped,finished,attempts,results},null,2));
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin===origin)return network(input,init);
  assert.ok(!stopped&&calls<maxCalls&&reportedCostUsd+geminiUpperEstimateUsd<maxCostUsd);
  assert.ok(['https://openrouter.ai','https://generativelanguage.googleapis.com'].includes(url.origin));
  const payload=JSON.parse(String(init?.body));
  if(url.origin==='https://openrouter.ai')assert.equal(payload.model,'deepseek/deepseek-v4.1-flash');
  else assert.match(url.pathname,/models\/(gemini-embedding-001|gemini-3\.1-flash-lite|gemini-2\.5-flash):/);
  const attempt:Record<string,unknown>={case:current,provider:url.hostname,operation:url.pathname,phase:'dispatched'};attempts.push(attempt);calls++;await persist();
  try{
    const response=await network(input,init),body=await response.clone().json();
    Object.assign(attempt,{status:response.status,phase:'received'});
    if(!response.ok){stopped=true;await persist();return response;}
    if(url.origin==='https://openrouter.ai'){
      assert.ok(Number.isFinite(body.usage?.cost)&&body.usage.cost>=0);reportedCostUsd+=body.usage.cost;attempt.costUsd=body.usage.cost;
      attempt.output=body.choices?.map((row:any)=>row.message?.content);
    }else{
      // A deliberately high estimate for the pinned models, not an invoice.
      const usage=body.usageMetadata;
      const inputTokens=usage?.promptTokenCount??Buffer.byteLength(String(init?.body));
      const outputTokens=(usage?.candidatesTokenCount??0)+(usage?.thoughtsTokenCount??0);
      const upper=(inputTokens*2+outputTokens*12)/1e6;geminiUpperEstimateUsd+=upper;attempt.upperEstimateUsd=upper;
    }
    if(reportedCostUsd+geminiUpperEstimateUsd>maxCostUsd)stopped=true;
    await persist();assert.ok(!stopped,'Evaluation cost bound reached');return response;
  }catch(error){stopped=true;attempt.phase='unknown_or_refused';await persist();throw error;}
};
async function drain(){
  const passes=[];
  for(let i=0;i<20&&!stopped;i++){
    const pass=await runBackgroundJobWorker({limit:8,now:new Date(Date.now()+1000)});passes.push(pass);
    assert.equal(pass.failed,0);assert.equal(pass.retried,0,'Retain provider errors instead of compressing retry time');
    if(pass.claimed===0){
      const [pending]=await fixture.sql`SELECT min(run_after) AS at FROM background_jobs WHERE status='pending'`;
      const gap=pending?.at?new Date(pending.at).getTime()-Date.now():Infinity;
      if(gap<=30000){await new Promise(done=>setTimeout(done,Math.max(50,Math.min(5000,gap+100))));continue;}
      break;
    }
  }
  assert.ok(!stopped);return passes;
}
try{
  for(const item of selected){
    current=item.id;
    const [account]=await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES(${`${item.id}@raw-quality.example.test`},now()) RETURNING id`;
    const [profile]=await fixture.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES(${account.id},'human','Synthetic raw quality',${item.locale}) RETURNING id`;
    const [source]=await fixture.sql`INSERT INTO inspirations(profile_id,text,kind) VALUES(${profile.id},${item.text},${item.type==='text'?'note':item.type}) RETURNING id`;
    let attachmentId:string|null=null;
    if(item.type!=='text'){
      const key='clip' in item?`profiles/${profile.id}/attachments/${item.clip}.wav`:null;
      const bytes=key?await readFile(`work/audio-transcription-eval/${'clip' in item?item.clip:''}.wav`):null;
      if(key&&bytes)files.set(`/raw-quality/${key}`,bytes);
      const [attachment]=await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size,enrichment_status)
        VALUES(${profile.id},${source.id},${item.type},${item.type==='link'?`${origin}/article`:item.type==='image'?`${origin}/image.png`:'https://example.test/synthetic.wav'},${key},${item.type==='image'?'image/png':item.type==='audio'?'audio/wav':null},${bytes?.length??null},'pending') RETURNING id`;
      attachmentId=attachment.id;await enqueueEnrichAttachment(profile.id,attachment.id,source.id);
    }else await enqueueDeriveSignals(profile.id,source.id,'created');
    const pipeline=await drain();
    const [attachment]=attachmentId?await fixture.sql`SELECT enrichment_status,enrichment_text,enrichment_error_reason FROM attachments WHERE id=${attachmentId}`:[];
    if(item.type==='link'){assert.ok(attachment.enrichment_text.includes(FIXTURE_ARTICLE_MARKER));assert.ok(!attachment.enrichment_text.includes(FIXTURE_ARTICLE_BOILERPLATE_MARKER));}
    if(item.type==='image')assert.match(attachment.enrichment_text,/LEAVE SOME SPACE/);
    if(item.type==='audio')assert.equal(attachment.enrichment_status,item.id==='silence'?'unavailable':'ready');
    const signalRows=await fixture.sql`SELECT id,statement,status FROM signals WHERE profile_id=${profile.id}`;
    const readings=await fixture.sql`SELECT e.body,e.type FROM top_of_mind_entries e JOIN top_of_minds m ON m.id=e.top_of_mind_id WHERE m.profile_id=${profile.id} AND m.status='live' AND e.dismissed_at IS NULL`;
    assert.equal((await fixture.sql`SELECT text FROM inspirations WHERE id=${source.id}`)[0].text,item.text);
    assert.equal((await fixture.sql`SELECT id FROM principles WHERE profile_id=${profile.id}`).length,0,'One source cannot establish a Principle');
    if(item.id==='silence'){assert.equal(attachment.enrichment_text,null);assert.equal(signalRows.length,0);assert.equal(readings.length,0);}
    const token=await signSessionToken({profileId:profile.id,email:`${item.id}@raw-quality.example.test`});await createSessionRow({profileId:profile.id,token});
    const id=crypto.randomUUID(),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const created=await app.fetch(new Request(`http://127.0.0.1/api/conversations?profile=${profile.id}`,{method:'POST',headers,body:JSON.stringify({id,firstMessage:{id:crypto.randomUUID(),content:item.question,requestReply:true}})}));assert.equal(created.status,200);
    const replyPasses=await drain();
    const readChat=()=>app.fetch(new Request(`http://127.0.0.1/api/conversations/${id}?profile=${profile.id}`,{headers}));
    let response=await readChat();assert.equal(response.status,200);let chat=await response.json() as any;
    const recovery:unknown[]=[];
    if(!chat.conversation.messages.some((row:any)=>row.role==='assistant')){
      const state=await (await app.fetch(new Request(`http://127.0.0.1/api/conversations/${id}/reply?profile=${profile.id}`,{headers}))).json() as any;
      recovery.push(state);
      if(state.canRetry&&['failed','stale'].includes(state.phase)){
        const retry=await app.fetch(new Request(`http://127.0.0.1/api/conversations/${id}/replies?profile=${profile.id}`,{method:'POST',headers,body:JSON.stringify({messageId:state.messageId,afterRequestId:state.requestId})}));assert.equal(retry.status,200);
        await drain();response=await readChat();chat=await response.json();
      }
    }
    if(!chat.conversation.messages.some((row:any)=>row.role==='assistant')){
      const jobs=await fixture.sql`SELECT type,status,last_error,run_after FROM background_jobs WHERE profile_id=${profile.id}`;
      results.push({id:item.id,enrichment:attachment??null,signals:signalRows,readings,chat:chat.conversation.messages,jobs,recovery,error:'reply_not_complete'});await persist();
    }
    assert.ok(chat.conversation.messages.some((row:any)=>row.role==='assistant'));
    assert.equal(chat.conversation.messages.filter((row:any)=>row.role==='user').length,1,'Retry cannot duplicate the human message');
    results.push({id:item.id,sourceText:item.text,enrichment:attachment??null,signals:signalRows,readings,chat:chat.conversation.messages,pipeline,replyPasses,recovery,semanticReview:'pending'});
    await persist();console.log(JSON.stringify({case:item.id,calls,signals:signalRows.length,readings:readings.length}));
  }
}finally{
  globalThis.fetch=network;await persist(true);await fixture.cleanup();await getDb().$client.end();
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
}
