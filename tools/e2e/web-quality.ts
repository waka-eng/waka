/** Manual built-browser quality walk. Requires the isolated capture fixture;
 * never targets dev/production accounts and makes no provider requests. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChromium} from './browser';
import type {Page} from 'playwright';

const origin='http://127.0.0.1:3015';
const stage=process.env.WAKA_WEB_QUALITY_STAGE??'baseline';
const large=process.env.WAKA_WEB_QUALITY_LARGE==='1';
assert.ok(['baseline','candidate'].includes(stage));
const output=resolve('work/web-quality',stage);await mkdir(output,{recursive:true});
const browser=await launchChromium({headless:true});
const reports:unknown[]=[];
const journeys:unknown[]=[];
let lastPage:Page|undefined;
try{
  const initial=await (await fetch(`${origin}/fixture`)).json();
  assert.equal(initial.origin,origin);assert.match(initial.schema,/^waka_test_[a-f0-9]+$/);
  assert.equal(initial.microphone,'synthetic tone','Only the isolated fixture is allowed');
  for(const size of [{width:1280,height:900},{width:390,height:844}]){
    for(const account of large?['primary']:['native','primary']){
      const label=large?'large':account;
      const context=await browser.newContext({viewport:size,reducedMotion:'reduce'});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();
      lastPage=page;page.setDefaultTimeout(10000);
      await page.request.get(`${origin}/fixture?account=${account}`);
      const start=performance.now();await page.goto(origin);
      const capture=page.locator('.jar-mouth-rest');await capture.waitFor({state:'visible'});
      const readyMs=performance.now()-start;
      // The layout has measured fonts and reached its normal ready state.
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:resolve(output,`${label}-${size.width}-home.png`)});
      const controls=await page.locator('button,a[href],[role=button],summary').evaluateAll(nodes=>nodes.filter(node=>{
        const box=node.getBoundingClientRect(),style=getComputedStyle(node);
        return box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth&&style.visibility!=='hidden'&&style.display!=='none'&&!node.closest('[hidden],[inert]');
      }).map(node=>({text:(node.textContent??'').trim(),label:node.getAttribute('aria-label'),tag:node.tagName})));
      await capture.click();const composer=page.getByRole('dialog',{name:'Capture inspiration',exact:true});
      await composer.waitFor({state:'visible'});
      const saveActions=await composer.locator('.jar-composer-actions button').allTextContents();
      if(stage==='candidate')assert.equal(saveActions.length,1,'Save is the only completion decision');
      const draft=`Quality draft ${account} ${size.width}`;
      await composer.locator('textarea').fill(draft);
      await composer.getByRole('button',{name:'close',exact:true}).click();
      await page.getByRole('button',{name:'Continue your draft',exact:true}).click();
      assert.equal(await composer.locator('textarea').inputValue(),draft);
      await page.screenshot({path:resolve(output,`${label}-${size.width}-capture.png`)});
      reports.push({account:label,viewport:size,readyMs,controls,saveActions,draftReturn:true});
      if(stage==='candidate'){
        await page.keyboard.press('Escape');
        const nav=page.getByRole('navigation',{name:'Your WAKA',exact:true});await nav.waitFor({state:'visible'});
        await nav.getByRole('button',{name:/^Inspirations/}).click();await page.waitForURL('**/?view=field');
        await page.goBack();await page.waitForURL(origin+'/');
        await nav.getByRole('button',{name:'Principles',exact:true}).click();await page.waitForURL('**/?view=sky');
        await nav.getByRole('button',{name:'Home',exact:true}).click();await page.waitForURL(origin+'/');
        await nav.getByRole('button',{name:'Find inspiration',exact:true}).click();
        await page.getByRole('dialog',{name:'Find inspiration',exact:true}).waitFor({state:'visible'});
        await page.keyboard.press('Escape');
      }
      await context.close();
    }
  }
  if(stage==='candidate')for(const size of [{width:1280,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport:size,reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage();lastPage=page;page.setDefaultTimeout(10000);let questionRequests=0;
    page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/reflection-question'))questionRequests++;});
    await page.request.get(`${origin}/fixture?account=primary`);await page.goto(origin);
    const before=await (await page.request.get(`${origin}/fixture`)).json();
    await page.locator('.jar-mouth-rest').click();
    const composer=page.getByRole('dialog',{name:'Capture inspiration',exact:true});
    const words=`Quality saved ${size.width} ${crypto.randomUUID()}`;await composer.locator('textarea').fill(words);
    assert.equal(await composer.getByRole('button',{name:'Only me',exact:true}).getAttribute('aria-pressed'),'true');
    await composer.getByRole('button',{name:'Save inspiration',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
    await composer.waitFor({state:'hidden'});await page.locator('.jar-capture-receipt').waitFor({state:'visible'});
    const after=await (await page.request.get(`${origin}/fixture`)).json();assert.equal(after.inspirations,before.inspirations+1);
    assert.equal(await page.locator('.jar-reflect-room').count(),0,'Save does not start reflection');
    await page.locator('.jar-capture-receipt').getByRole('button',{name:'reflect',exact:true}).click();
    const reflection=page.locator('.jar-reflect-room');await reflection.waitFor({state:'visible'});
    const beforeReflection=questionRequests;
    await reflection.locator('textarea').fill('I want room to think before deciding what an idea should become.');
    await reflection.getByRole('button',{name:'Save thought',exact:true}).click();
    await reflection.getByRole('status').filter({hasText:'Your thought is saved.'}).waitFor({state:'visible'});
    assert.equal(questionRequests,beforeReflection,'Saving a reflection does not request a question');
    const questionResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/reflection-question'));
    await reflection.getByRole('button',{name:'Explore another question',exact:true}).click();await questionResponse;
    await page.request.get(`${origin}/fixture?question=complete`);
    await reflection.getByText('What would a small first step make possible for you?',{exact:true}).waitFor({state:'visible'});
    assert.equal(questionRequests,beforeReflection+1);
    await page.keyboard.press('Escape');
    const nav=page.getByRole('navigation',{name:'Your WAKA',exact:true});
    await nav.getByRole('button',{name:'Find inspiration',exact:true}).click();
    const search=page.getByRole('dialog',{name:'Find inspiration',exact:true});await search.locator('input').fill(words);
    await search.locator('.jar-search-results button').first().click();await page.locator('.jar-panel').waitFor({state:'visible'});
    assert.ok((await page.locator('.jar-panel').textContent())?.includes(words));
    await page.screenshot({path:resolve(output,`saved-${size.width}.png`)});
    await page.keyboard.press('Escape');await nav.getByRole('button',{name:'Home',exact:true}).click();
    await page.locator('.jar-home-activities button').filter({hasText:/Resume review|Review your inspirations/}).click();
    const review=page.locator('.jar-review');await review.locator('.jar-review-card').waitFor({state:'visible'});
    const actions=review.locator('.jar-item-actions');assert.equal(await actions.evaluate((node:HTMLDetailsElement)=>node.open),false);
    await actions.locator('summary').press('Enter');assert.equal(await actions.getByRole('button',{name:'Remove',exact:true}).isVisible(),true);
    await actions.locator('summary').press('Escape');assert.equal(await review.isVisible(),true);assert.equal(await actions.evaluate((node:HTMLDetailsElement)=>node.open),false);
    const beforeNext=await (await page.request.get(`${origin}/fixture`)).json();await review.getByRole('button',{name:'Next inspiration →',exact:true}).click();
    await review.locator('.jar-review-card').waitFor({state:'visible'});const afterNext=await (await page.request.get(`${origin}/fixture`)).json();
    assert.equal(afterNext.inspirations,beforeNext.inspirations,'Next keeps the inspiration');
    await page.keyboard.press('Escape');await nav.getByRole('button',{name:'Home',exact:true}).click();
    await page.locator('.jar-home-activities button').filter({hasText:'Talk with WAKA'}).click();
    const chat=page.locator('.chat-page');await chat.locator('.chat-input-row textarea').fill('Help me make room for ideas before deciding.');
    const sent=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/conversations');
    await chat.getByRole('button',{name:'Send',exact:true}).click();await sent;await page.request.get(`${origin}/fixture?conversation-reply=complete`);
    const reply=chat.locator('.chat-messages [data-role="assistant"]').last();await reply.waitFor({state:'visible'});
    const sourceSummary=reply.locator('.chat-source-summary');assert.equal(await sourceSummary.evaluate((node:HTMLDetailsElement)=>node.open),false);
    await sourceSummary.locator('summary').press('Enter');assert.ok(await sourceSummary.locator('button').count()>0);
    await reply.locator('.jar-item-actions summary').press('Enter');
    await reply.getByRole('button',{name:'Correct reply',exact:true}).click();assert.equal(await chat.locator('.chat-correction').isVisible(),true);
    await page.screenshot({path:resolve(output,`chat-${size.width}.png`)});
    journeys.push({viewport:size,confirmedSaves:1,duplicateWrites:0,automaticReflections:0,optionalReflect:true,searchReopen:true,
      saveBeforeQuestion:true,explicitQuestion:true,reviewNextKeeps:true,keyboardItemActions:true,chatSources:true,chatCorrection:true});
    await context.close();
  }
  const final=await (await fetch(`${origin}/fixture`)).json();
  await writeFile(resolve(output,large?'large-audit.json':'audit.json'),JSON.stringify({stage,providerNetworkCalls:0,
    syntheticModelCalls:{reflection:final.reflectionCalls-initial.reflectionCalls,conversation:final.conversationCalls-initial.conversationCalls},reports,journeys},null,2));
  console.log(JSON.stringify({stage,reports:reports.length,draftReturns:reports.length,output}));
}catch(error){
  if(lastPage&&!lastPage.isClosed()){
    await lastPage.screenshot({path:resolve(output,'failure.png')});
    await writeFile(resolve(output,'failure.json'),JSON.stringify({url:lastPage.url(),state:await lastPage.evaluate(()=>({active:{tag:document.activeElement?.tagName,class:document.activeElement?.className},dialogs:[...document.querySelectorAll('[role=dialog]')].map(node=>({label:node.getAttribute('aria-label'),text:node.textContent?.slice(0,1200)}))}))},null,2));
  }
  throw error;
}finally{
  await fetch(`${origin}/fixture?account=primary`);
  await browser.close();
}
