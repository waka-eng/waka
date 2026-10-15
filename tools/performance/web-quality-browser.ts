/** Manual current-build readiness gate against the disposable performance fixture. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChromium} from '../e2e/browser';
const origin='http://127.0.0.1:3017',output=resolve('work/web-quality/performance');
const info=await (await fetch(`${origin}/perf/results`)).json();assert.ok(Array.isArray(info.httpRequests));
const browser=await launchChromium({headless:true});const results:unknown[]=[];
const summary=(rows:number[])=>{const sorted=[...rows].sort((a,b)=>a-b);return {samples:sorted.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};};
try{
  for(const size of [{width:1280,height:900},{width:390,height:844}]){
    const home:number[]=[],review:number[]=[],warm:number[]=[];
    for(let i=0;i<20;i++){
      const context=await browser.newContext({viewport:size,reducedMotion:'reduce'});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();page.setDefaultTimeout(15000);
      await page.goto(`${origin}/perf/scenario?size=2000&delay=150&review=fresh`);
      await page.waitForFunction(()=>Boolean(document.documentElement.dataset.wakaReady));
      home.push(await page.evaluate(()=>Number(document.documentElement.dataset.wakaReady)));
      await page.locator('.jar-home-activities button').filter({hasText:/Review your inspirations|Resume review/}).click();
      await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.wakaAction??'{}').mode==='review');
      review.push(await page.evaluate(()=>JSON.parse(document.documentElement.dataset.wakaAction!).durationMs));
      await page.keyboard.press('Escape');await page.locator('.jar-home-activities').waitFor({state:'visible'});
      await page.locator('.jar-home-activities button').filter({hasText:'Talk with WAKA'}).click();
      await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.wakaAction??'{}').mode==='chat');
      await page.locator('.chat-header button').first().click();
      await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.wakaAction??'{}').mode==='return');
      warm.push(await page.evaluate(()=>JSON.parse(document.documentElement.dataset.wakaAction!).durationMs));
      await context.close();
    }
    const row={viewport:size,home:summary(home),review:summary(review),warm:summary(warm)};results.push(row);
    console.log(JSON.stringify(row));
    assert.ok(row.home.medianMs<=800&&row.home.p95Ms<=1200,'Existing Home readiness gate');
    assert.ok(row.review.medianMs<=500,'Existing Review readiness gate');
    assert.ok(row.warm.medianMs<=400,'Existing warm-return gate');
  }
  await mkdir(output,{recursive:true});await writeFile(resolve(output,'browser.json'),JSON.stringify({environment:'current production build, synthetic loopback, 150 ms added API delay',providerCalls:0,results},null,2));
}finally{await browser.close();}
