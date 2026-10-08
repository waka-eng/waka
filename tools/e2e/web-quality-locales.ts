/** Manual narrow-layout check using a synthetic fixture's actual language setting. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChromium} from './browser';
const origin='http://127.0.0.1:3015',output=resolve('work/web-quality/locales');
const meta=await (await fetch(`${origin}/fixture`)).json();assert.equal(meta.origin,origin);assert.match(meta.schema,/^waka_test_[a-f0-9]+$/);
const messages=JSON.parse(await readFile('packages/web/src/lib/i18n/messages/ko-KR.json','utf8'));
await mkdir(output,{recursive:true});const browser=await launchChromium({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(10000);const results:unknown[]=[];
try{
  await page.request.get(`${origin}/fixture?account=primary`);await page.goto(`${origin}/profile`);
  await page.locator('[name=preferredLocale]').selectOption('ko-KR');
  await page.getByRole('status').filter({hasText:messages.profileLanguageSaved}).waitFor({state:'visible'});
  for(const size of [{width:320,height:568},{width:390,height:844}]){
    await page.setViewportSize(size);await page.goto(origin);await page.locator('.jar-mouth-rest').waitFor({state:'visible'});
    const nav=page.locator('.jar-personal-navigation');
    const labels=await nav.locator('button').evaluateAll(nodes=>nodes.map(node=>node.childNodes[0]?.textContent?.trim()));
    assert.deepEqual(labels,[messages.worldPersonalHome,messages.worldPersonalInspirations,messages.worldPrinciplesShortcut,messages.worldPersonalFind]);
    const targets=await nav.locator('button').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {width:rect.width,height:rect.height,left:rect.left,right:rect.right};}));
    assert.ok(targets.every(rect=>rect.width>=44&&rect.height>=44&&rect.left>=0&&rect.right<=size.width));
    await page.screenshot({path:resolve(output,`ko-${size.width}-home.png`)});
    await page.locator('.jar-mouth-rest').click();const composer=page.locator('.jar-inspiration-composer');
    await composer.locator('textarea').fill('작게 시작하고 원할 때 다시 돌아보고 싶어요.');
    assert.equal(await composer.locator('.jar-composer-actions button').count(),1);
    assert.equal(await composer.locator('.jar-composer-actions button').textContent(),messages.worldSave);
    await page.screenshot({path:resolve(output,`ko-${size.width}-capture.png`)});await page.keyboard.press('Escape');
    results.push({viewport:size,labels,targets,singleSave:true});
  }
  await writeFile(resolve(output,'audit.json'),JSON.stringify({locale:'ko-KR',providerNetworkCalls:0,results},null,2));
  console.log(JSON.stringify({output,viewports:results.length,locale:'ko-KR'}));
}finally{
  await page.goto(`${origin}/profile`);await page.locator('[name=preferredLocale]').selectOption('en-US');
  const english=JSON.parse(await readFile('packages/web/src/lib/i18n/messages/en-US.json','utf8'));
  await page.getByRole('status').filter({hasText:english.profileLanguageSaved}).waitFor({state:'visible'});
  await browser.close();
}
