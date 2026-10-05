/** Sequential interleaved comparison, no provider calls or real accounts.
 * Requires two live disposable performance fixtures. Cookies are never saved. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const samples=Number(process.env.WAKA_PERFORMANCE_SAMPLES??30);assert.ok(Number.isInteger(samples)&&samples>=5&&samples<=60);
const origins=[process.env.WAKA_PERFORMANCE_BASELINE_ORIGIN,process.env.WAKA_PERFORMANCE_CANDIDATE_ORIGIN].map(value=>{
  const u=new URL(value??'');assert.equal(u.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(u.hostname));assert.equal(u.username,'');assert.equal(u.password,'');return u.origin;
});assert.notEqual(origins[0],origins[1]);
const cookies:string[]=[];
for(const origin of origins){const setup=await fetch(origin+'/perf/scenario?size=10000&delay=0',{redirect:'manual'});assert.equal(setup.status,302);const cookie=setup.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);cookies.push(cookie);}
const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2),round=(n:number)=>Math.round(n*100)/100;return {medianMs:round(s.length%2?s[m]:(s[m-1]+s[m])/2),p95Ms:round(s[Math.ceil(s.length*.95)-1]),maxMs:round(s.at(-1)!)};};
const results=[];
for(const [label,path] of [['context','/perf/context'],['top_of_mind','/api/top-of-mind'],['principles','/api/principles']] as const){
  const values=[[] as number[],[] as number[]];let normalized:unknown;
  const call=async(which:number)=>{
    const start=performance.now(),response=await fetch(origins[which]+path,{headers:{Cookie:cookies[which]}});assert.equal(response.status,200);
    const body=await response.json() as any,elapsed=performance.now()-start;
    if(label==='context'){
      assert.equal(body.sqlQueries,3);if(normalized===undefined)normalized=body.context;else assert.deepEqual(body.context,normalized,'Normalized synthetic context changed');return body.durationMs as number;
    }
    return elapsed;
  };
  await call(0);await call(1);
  for(let n=0;n<samples;n++)for(const which of n%2?[1,0]:[0,1])values[which].push(await call(which));
  const result={label,before:stats(values[0]),after:stats(values[1]),...(label==='context'?{normalizedContextParity:true}:{} )};results.push(result);console.log(JSON.stringify(result));
}
const output=resolve(process.env.WAKA_PERFORMANCE_OUTPUT??'work/performance/reader-comparison');await mkdir(output,{recursive:true});
await writeFile(resolve(output,'interleaved.json'),JSON.stringify({samples,fixture:{inspirations:10000,delayMs:0},results,providerCalls:0},null,2));
