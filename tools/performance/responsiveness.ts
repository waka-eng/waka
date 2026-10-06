/** Manual model-free pool-one benchmark. Every write is in its own disposable
 * loopback schema. FIFO delay models serial DB transport, not provider/cloud
 * latency. Query parameters and raw account content never enter the receipt. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {createReviewSession,advanceReviewSession} from '../../packages/api/src/lib/review-sessions.js';
import {readConversationReplyState} from '../../packages/api/src/lib/conversation-replies.js';
import {writeEvaluationSnapshot} from '../e2e/evaluation-journal.js';

const url=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&/test|disposable/i.test(url.pathname));
assert.equal(url.searchParams.has('options'),false);assert.equal(process.env.WAKA_TEST_SCHEMA,undefined);
const label=process.argv.find(x=>x.startsWith('--label='))?.slice(8)??'baseline';assert.match(label,/^[a-z0-9-]+$/);
const samples=Number(process.env.WAKA_PERFORMANCE_SAMPLES??12);assert.ok(Number.isInteger(samples)&&samples>=5&&samples<=30);
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';process.env.WAKA_CONVERSATION_REPLIES='1';
delete process.env.OPENROUTER_API_KEY;delete process.env.GEMINI_API_KEY;delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION;
globalThis.fetch=async()=>{throw new Error('Responsiveness benchmark refuses provider traffic');};
let interrupted=false;process.once('SIGTERM',()=>{interrupted=true;});process.once('SIGINT',()=>{interrupted=true;});
const fixture=await createTestDatabase();
let driverStatements=0,recording=false;
(fixture.sql.options as any).debug=(_connection:unknown,query:string)=>{if(recording&&!/^(begin|commit|rollback|set transaction)\b/i.test(query.trim()))driverStatements++;};
const results:unknown[]=[];
const hashes=Object.fromEntries(['packages/api/src/lib/review-sessions.ts','packages/api/src/lib/conversation-replies.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
// Builder proxies retain real SQL and transaction semantics. Only awaited
// statements are delayed, serially, just as one connection queues them.
function instrument(delay:number){
  let statements=0,tail=Promise.resolve();
  const builders=new WeakMap<object,any>();
  const wrap=(target:any):any=>{
    if(!target||typeof target!=='object'||![target.then,target.from,target.values,target.set].some(value=>typeof value==='function'))return target;
    if(builders.has(target))return builders.get(target);
    const proxy=new Proxy(target,{get(object,key){
      if(key==='then'&&typeof object.then==='function')return (resolve:any,reject:any)=>{
        statements++;
        const pending=tail.then(async()=>{if(delay)await new Promise(r=>setTimeout(r,delay));return await object;});
        tail=pending.then(()=>{},()=>{});return pending.then(resolve,reject);
      };
      const value=Reflect.get(object,key,object);
      return typeof value==='function'? (...args:any[])=>wrap(value.apply(object,args)):value;
    }});builders.set(target,proxy);return proxy;
  };
  const txWrap=(tx:any)=>new Proxy(tx,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?(...args:any[])=>wrap(value.apply(target,args)):value;}});
  const db=new Proxy(fixture.db,{get(target,key){if(key==='transaction')return (run:any,options:any)=>target.transaction(tx=>run(txWrap(tx)),options);
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  return {db:db as never,count:()=>statements};
}
const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b),mid=Math.floor(s.length/2);return {median:Math.round((s.length%2?s[mid]:(s[mid-1]+s[mid])/2)*100)/100,p95:s[Math.ceil(s.length*.95)-1]};};
try{
  const [account]=await fixture.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [owner]=await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Synthetic responsiveness') RETURNING id`;
  await fixture.sql`INSERT INTO inspirations(profile_id,text,created_at) SELECT ${owner.id},'Synthetic inspiration '||i,now()-i*interval '1 second' FROM generate_series(1,250) i`;
  const conversation=randomUUID(),user=randomUUID(),job=randomUUID(),request=randomUUID();
  await fixture.sql`INSERT INTO conversations(id,profile_id,revision) VALUES(${conversation},${owner.id},1)`;
  await fixture.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content) VALUES(${user},${owner.id},${conversation},1,'user','Synthetic question')`;
  await fixture.sql`INSERT INTO background_jobs(id,type,status,payload,profile_id,locked_at,attempts) VALUES(${job},'generate_conversation_reply','running','{}',${owner.id},now(),1)`;
  await fixture.sql`INSERT INTO conversation_reply_requests(id,profile_id,conversation_id,user_message_id,conversation_revision,context_hash,status,job_id,dispatched_at) VALUES(${request},${owner.id},${conversation},${user},1,'synthetic','running',${job},now())`;
  for(const delay of [0,50])for(const operation of ['review_next','chat_poll'] as const){
    const ms:number[]=[],counts:number[]=[];
    for(let i=0;i<samples;i++){
      if(interrupted)throw new Error('Benchmark interrupted');
      const meter=instrument(delay);
      if(operation==='review_next'){
        const current=await createReviewSession(fixture.db as never,owner.id,{id:randomUUID()},true);assert.ok(current?.currentInspiration);
        const source=current.items[0],start=performance.now();driverStatements=0;recording=true;
        const next=await advanceReviewSession(meter.db,owner.id,current.id,{nextId:randomUUID(),revision:current.revision,inspirationId:source.inspirationId,sourceRevision:source.currentRevision,choice:'skip'});
        ms.push(performance.now()-start);assert.ok(next?.currentInspiration);assert.notEqual(next.currentInspirationId,current.currentInspirationId);
        assert.equal(next.currentInspiration.profileId,owner.id);assert.equal(next.items.length,1);assert.equal(next.currentInspiration.materialRevision,next.items[0].currentRevision);
      }else{
        driverStatements=0;recording=true;
        const start=performance.now(),state=await readConversationReplyState(meter.db,owner.id,conversation);ms.push(performance.now()-start);
        assert.equal(state.phase,'running');assert.equal(state.requestId,request);assert.equal(state.messageId,user);assert.equal(state.canRetry,false);assert.equal(state.retryAfter,null);
      }
      recording=false;assert.ok(meter.count()>0);assert.equal(meter.count(),driverStatements,'Transport simulation missed an awaited SQL statement');
      counts.push(meter.count());
    }
    const result={operation,statementDelayMs:delay,applicationStatements:stats(counts),durationMs:stats(ms)};results.push(result);console.log(JSON.stringify(result));
  }
}finally{await fixture.cleanup();}
const output=`work/performance/responsiveness-${label}.json`;
writeEvaluationSnapshot(output,{label,samples,sourceHashes:hashes,poolMax:1,results,providerCalls:0,remoteWrites:0,cleaned:true,scope:'Real SQL, synthetic output checks; FIFO delay is a local DB transport simulation, not cloud p95'});
console.log(JSON.stringify({output,cleaned:true}));
