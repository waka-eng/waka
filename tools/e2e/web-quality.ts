/** Manual built-browser quality walk. Requires the isolated capture fixture;
 * never targets dev/production accounts and makes no provider requests. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChromium} from './browser';

const origin='http://127.0.0.1:3015';
const stage=process.env.WAKA_WEB_QUALITY_STAGE??'baseline';
const large=process.env.WAKA_WEB_QUALITY_LARGE==='1';
assert.ok(['baseline','candidate'].includes(stage));
const output=resolve('work/web-quality',stage);await mkdir(output,{recursive:true});
const browser=await launchChromium({headless:true});
const reports:unknown[]=[];
try{
  for(const size of [{width:1280,height:900},{width:390,height:844}]){
    for(const account of large?['primary']:['native','primary']){
      const label=large?'large':account;
      const context=await browser.newContext({viewport:size,reducedMotion:'reduce'});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();
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
      const draft=`Quality draft ${account} ${size.width}`;
      await composer.locator('textarea').fill(draft);
      await composer.getByRole('button',{name:'close',exact:true}).click();
      await page.getByRole('button',{name:'Continue your draft',exact:true}).click();
      assert.equal(await composer.locator('textarea').inputValue(),draft);
      await page.screenshot({path:resolve(output,`${label}-${size.width}-capture.png`)});
      reports.push({account:label,viewport:size,readyMs,controls,saveActions,draftReturn:true});
      await context.close();
    }
  }
  await writeFile(resolve(output,large?'large-audit.json':'audit.json'),JSON.stringify({stage,providerCalls:0,reports},null,2));
  console.log(JSON.stringify({stage,reports:reports.length,draftReturns:reports.length,output}));
}finally{
  await fetch(`${origin}/fixture?account=primary`);
  await browser.close();
}
