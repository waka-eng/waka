/** Interleaved HTTP comparison of two live disposable performance fixtures.
 * Rejects non-loopback origins. Cookies stay in memory and are never logged. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {searchCases} from './search-cases.js';
const samples=Number(process.env.WAKA_PERFORMANCE_SAMPLES??30);
assert.ok(Number.isInteger(samples)&&samples>=5&&samples<=60);
const output=resolve(process.env.WAKA_PERFORMANCE_OUTPUT??'work/performance/search-comparison');await mkdir(output,{recursive:true});
const origins=[process.env.WAKA_PERFORMANCE_BASELINE_ORIGIN,process.env.WAKA_PERFORMANCE_CANDIDATE_ORIGIN].map(value=>{
  const url=new URL(value??'');assert.equal(url.protocol,'http:');assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
  assert.equal(url.username,'');assert.equal(url.password,'');return url.origin;
});
assert.notEqual(origins[0],origins[1]);
const cookies:string[]=[];
for(const origin of origins){
  const setup=await fetch(origin+'/perf/scenario?size=10000&delay=0',{redirect:'manual'});assert.equal(setup.status,302);
  const cookie=setup.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);cookies.push(cookie);
  const state=await(await fetch(origin+'/perf/results')).json() as {size:number;delayMs:number};assert.equal(state.size,10000);assert.equal(state.delayMs,0);
}
const round=(n:number)=>Math.round(n*100)/100;
const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b),mid=Math.floor(s.length/2);return {medianMs:round(s.length%2?s[mid]:(s[mid-1]+s[mid])/2),p95Ms:round(s[Math.ceil(s.length*.95)-1]),maxMs:round(s.at(-1)!)};};
const results=[];
for(const entry of searchCases){
  const expected=Array.from({length:10000},(_,index)=>index+1).filter(n=>entry.contains(n,10000));
  const times=[[] as number[],[] as number[]];
  const read=async(which:number)=>{
    const start=performance.now();
    const response=await fetch(origins[which]+'/api/inspirations?limit=40&q='+encodeURIComponent(entry.query),{headers:{Cookie:cookies[which]}});
    assert.equal(response.status,200);
    const body=await response.json() as {total:number;inspirations:Array<{textPreview:string}>};
    const duration=performance.now()-start;
    assert.equal(body.total,expected.length,entry.label+' total');
    const ordinals=body.inspirations.map(row=>Number(/^Synthetic performance inspiration (\d+)\./.exec(row.textPreview)?.[1]));
    assert.deepEqual(ordinals,expected.slice(0,40),entry.label+' page parity');
    return duration;
  };
  await read(0);await read(1);
  for(let n=0;n<samples;n++)for(const which of n%2?[1,0]:[0,1])times[which].push(await read(which));
  const result={case:entry.label,matchingOriginals:expected.length,before:stats(times[0]),after:stats(times[1]),firstPageParityVerified:true};
  results.push(result);console.log(JSON.stringify(result));
}
await writeFile(resolve(output,'interleaved.json'),JSON.stringify({samples,fixture:{inspirations:10000,otherAccounts:[25,250,2000],delayMs:0},results},null,2));
console.log(JSON.stringify({cases:results.length,allCandidateP95Under100:results.every(row=>row.after.p95Ms<100),providerCalls:0}));
