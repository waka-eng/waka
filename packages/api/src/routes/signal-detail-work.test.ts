import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {getTableName} from 'drizzle-orm';
import {afterEach,expect,it,vi} from 'vitest';
import {getProfileSignal} from './signals.js';

/** Exercise the real reader with deterministic query results. No database or
 * provider is connected; visit counts measure projection work, not SQL latency. */
function fixture(size:number){
 let attachmentVisits=0,queries=0;
 const date=new Date('2026-11-01T00:00:00Z'),evidence:any[]=[],enriched:any[]=[],support:any[]=[];
 for(let i=0;i<size;i++){
  const id=`source-${i}`,quote=`Synthetic evidence phrase number ${i}.`;
  evidence.push({inspirationId:id,reason:'Synthetic support',quote,quoteSource:'enrichment',quoteReflectionId:null,material:true,current:true,createdAt:date,text:'Synthetic capture'});
  for(const text of [null,'Unrelated attachment',`Before. ${quote} After.`,quote,'Another attachment','Last attachment'])enriched.push({get inspirationId(){attachmentVisits++;return id;},text});
  support.push({signalId:'signal',unitId:id,kind:'inspiration',originId:id,createdAt:date,source:'app',current:true});
 }
 const rows:Record<string,any[]>={signals:[{id:'signal',statement:'Human wording stays locked.',status:'active',confidence:50,lastEvidenceAt:date,lockedAt:date,unsupportedAt:null,dismissedAt:null,createdAt:date}],signal_evidence:evidence,attachments:enriched};
 const db={execute:async()=>{queries++;return support;},select:()=>{
  let table='';const q:any={from(t:any){table=getTableName(t);return q;},innerJoin(){return q;},where(){return q;},orderBy(){return q;},limit(){return q;},then(resolve:any,reject:any){queries++;return Promise.resolve(rows[table]??[]).then(resolve,reject);}};return q;
 }};
 return {db:db as any,evidence,enriched,counts:()=>({attachmentVisits,queries})};
}
afterEach(()=>vi.useRealTimers());
function fixedTime(){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));}
it('preserves first matching attachment quote, missing/null text, stale suppression and reflection identity',async()=>{
 fixedTime();const f=fixture(4);
 f.enriched.push({inspirationId:null,text:'Unrelated chat-only material'});
 f.evidence[1].inspirationId='missing';f.evidence[2].current=false;
 f.evidence[3].quoteSource='own';f.evidence[3].quoteReflectionId='missing-reflection';
 const row=await getProfileSignal(f.db,{profileId:'owner',signalId:'signal'});
 expect(row?.locked).toBe(true);expect(row?.statement).toBe('Human wording stays locked.');
 expect(row?.evidence).toHaveLength(4);
 expect(row?.evidence.map(e=>[e.quote,e.quoteSource,e.quoteReflectionId,e.reason])).toEqual([
  ['Synthetic evidence phrase number 0.','enrichment',null,'Synthetic support'],
  [null,null,null,'Synthetic support'],[null,null,null,null],[null,null,null,'Synthetic support'],
 ]);
});
it('keeps actual enrichment matching work linear for evidence-rich signal detail',async()=>{
 fixedTime();const samples=process.env.WAKA_MEASURE_SIGNAL_DETAIL==='1'?7:1,readings:number[]=[],digests=new Set<string>();let count={attachmentVisits:0,queries:0};
 for(let sample=0;sample<samples;sample++){
  const f=fixture(2000),start=performance.now(),row=await getProfileSignal(f.db,{profileId:'owner',signalId:'signal'});
  readings.push(performance.now()-start);count=f.counts();
  expect(row?.evidence).toHaveLength(2000);expect(row?.evidence.every((e,i)=>e.quote===`Synthetic evidence phrase number ${i}.`)).toBe(true);
  digests.add(createHash('sha256').update(JSON.stringify(row)).digest('hex'));
 }
 expect(digests.size).toBe(1);
 if(process.env.WAKA_MEASURE_SIGNAL_DETAIL==='1')console.info(JSON.stringify({measurement:'signal-detail-projection',evidence:2000,readyAttachments:12000,samples,medianMs:readings.sort((a,b)=>a-b)[Math.floor(samples/2)],attachmentIdentityVisits:count.attachmentVisits,queryCalls:count.queries,outputDigest:[...digests][0],realSqlOrNetwork:false}));
 expect(count.attachmentVisits).toBeLessThanOrEqual(24000);
});
