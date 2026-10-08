/** One completion action for a URL draft, through the real isolated save API. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchChromium} from './browser';
const origin='http://127.0.0.1:3015',meta=await(await fetch(`${origin}/fixture`)).json();
assert.equal(meta.origin,origin);assert.match(meta.schema,/^waka_test_[a-f0-9]+$/);
const browser=await launchChromium({headless:true}),results=[];
try{
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage();await page.request.get(`${origin}/fixture?account=primary`);await page.goto(origin);
    await page.locator('.jar-mouth-rest').click();const composer=page.locator('.jar-inspiration-composer');
    const id=crypto.randomUUID(),note=`Link idea ${id}`,url=`https://example.test/${id}`;
    await composer.locator('textarea').fill(note);await composer.getByRole('button',{name:'＋ Link',exact:true}).click();
    await composer.locator('input[type=url]').fill(url);await page.keyboard.press('Escape');
    await page.locator('.jar-mouth-rest').click();assert.equal(await composer.locator('input[type=url]').inputValue(),url);
    assert.equal(await composer.locator('.jar-composer-actions button').count(),1);
    const before=await(await page.request.get(`${origin}/fixture`)).json();
    await composer.getByRole('button',{name:'Save inspiration',exact:true}).click();await composer.waitFor({state:'hidden'});
    const after=await(await page.request.get(`${origin}/fixture`)).json();assert.equal(after.inspirations,before.inspirations+1);assert.equal(after.attachments,before.attachments+1);
    await page.reload();await page.locator('.jar-mouth-rest').waitFor({state:'visible'});
    assert.equal((await page.locator('.jar-mouth-rest').textContent())?.trim(),'Capture inspiration');
    await page.getByRole('navigation',{name:'Your WAKA'}).getByRole('button',{name:'Find inspiration'}).click();
    const search=page.locator('.jar-inspiration-search');await search.locator('input').fill(id);await search.locator('.jar-search-results button').first().click();
    await page.locator('.jar-panel').waitFor({state:'visible'});const text=await page.locator('.jar-panel').textContent();assert.ok(text?.includes(note)&&text?.includes(url));
    results.push({width,draftRestored:true,saves:1,attachments:1,exactWordsReopened:true});await context.close();
  }
  await mkdir('work/web-quality',{recursive:true});await writeFile('work/web-quality/link-save.json',JSON.stringify({providerCalls:0,results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
