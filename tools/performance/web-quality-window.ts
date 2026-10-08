/** Full first-minute request budget, using the isolated performance fixture. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChromium} from '../e2e/browser';
const origin='http://127.0.0.1:3017',output=resolve('work/web-quality/performance');
const info=await (await fetch(`${origin}/perf/results`)).json();assert.ok(Array.isArray(info.httpRequests));
const browser=await launchChromium({headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();await page.goto(`${origin}/perf/scenario?size=2000&delay=150`);
  await page.waitForTimeout(30000);await page.waitForTimeout(30000);
  const result=await (await page.request.get(`${origin}/perf/results`)).json();
  const originalReads=result.httpRequests.filter((row:{path:string})=>/^\/api\/inspirations\/\{id\}(?:\?|$)/.test(row.path)).length;
  const roomReads=result.httpRequests.filter((row:{path:string})=>/^\/api\/groups\/\{id\}\/(inspirations|signals|top-of-mind|principles)/.test(row.path)).length;
  const receipt={size:2000,addedApiDelayMs:150,windowSeconds:60,providerCalls:0,totalRequests:result.httpRequests.length,originalReads,roomReads,requests:result.httpRequests};
  await mkdir(output,{recursive:true});await writeFile(resolve(output,'request-window.json'),JSON.stringify(receipt,null,2));
  assert.ok(receipt.totalRequests<=40&&originalReads<=4&&roomReads===0,'Existing first-minute request gate');
  console.log(JSON.stringify({...receipt,requests:undefined}));
}finally{await browser.close();}
