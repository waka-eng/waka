/** Real write-boundary faults against the isolated synthetic capture fixture. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {launchChromium} from './browser';
import type {Page} from 'playwright';
const origin='http://127.0.0.1:3015',output=resolve('work/web-quality/faults');
const meta=await (await fetch(`${origin}/fixture`)).json();assert.equal(meta.origin,origin);assert.match(meta.schema,/^waka_test_[a-f0-9]+$/);
const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZqEAAAAASUVORK5CYII=','base64');
interface UploadProof{cookie:boolean;authorization:boolean;type:string;bytes:number;sha256:string}
await mkdir(output,{recursive:true});const browser=await launchChromium({headless:true});const results:unknown[]=[];
let lastPage:Page|undefined,lastFault='',lastPosts=0;
try{
  for(const fault of ['save-request','save-response','offline','second-upload']){
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage();lastPage=page;lastFault=fault;lastPosts=0;page.setDefaultTimeout(10000);let posts=0;
    const uploadChecks:Promise<UploadProof>[]=[];
    page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/inspirations'){posts++;lastPosts=posts;}});
    page.on('request',request=>{if(request.method()==='PUT')uploadChecks.push((async()=>{
      const headers=await request.allHeaders(),bytes=request.postDataBuffer()??Buffer.alloc(0);
      return {cookie:Boolean(headers.cookie),authorization:Boolean(headers.authorization),type:headers['content-type'],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    })());});
    await page.request.get(`${origin}/fixture?account=primary`);await page.goto(origin);await page.locator('.jar-mouth-rest').click();
    const composer=page.locator('.jar-inspiration-composer'),words=`Fault ${fault} ${crypto.randomUUID()}`;
    await composer.locator('textarea').fill(words);const before=await (await page.request.get(`${origin}/fixture`)).json();
    if(fault==='second-upload')await composer.locator('input[type=file]').setInputFiles([
      {name:'first.png',mimeType:'image/png',buffer:imageBytes},
      {name:'second.png',mimeType:'image/png',buffer:imageBytes}
    ]);
    if(fault==='save-request'||fault==='save-response'){
      let injected=0;
      await page.route('**/api/inspirations*',async route=>{
        if(injected>=(fault==='save-response'?2:1)||route.request().method()!=='POST'||new URL(route.request().url()).pathname!=='/api/inspirations'){await route.continue();return;}
        injected++;
        // A local browser abort cannot be transparently retried by TCP.
        // For response loss, the real route commits before the browser sees failure.
        if(fault==='save-response'){const committed=await route.fetch();assert.equal(committed.status(),injected===1?201:200);}
        await route.abort('failed');
      });
    }else if(fault==='offline')await context.setOffline(true);else await page.request.get(`${origin}/fixture?fail=${fault}`);
    await composer.getByRole('button',{name:'Save inspiration',exact:true}).click();
    const recovery=fault==='second-upload'?composer.getByRole('button',{name:/Retry upload for second.png/}):composer.locator('.jar-source-status').getByRole('button',{name:'Try again',exact:true});
    await recovery.waitFor({state:'visible'});assert.equal(await composer.locator('textarea').inputValue(),words);
    assert.equal(await page.locator('.jar-capture-receipt').count(),0,'An unconfirmed operation is not presented as a successful save');
    if(fault==='offline')await context.setOffline(false);
    const failed=await (await page.request.get(`${origin}/fixture`)).json();
    assert.equal(failed.inspirations,before.inspirations+(fault==='save-response'?1:0));
    await page.screenshot({path:resolve(output,`${fault}-preserved.png`)});
    await recovery.click();
    if(fault==='second-upload'){
      await composer.getByRole('button',{name:/Retry upload for second.png/}).waitFor({state:'hidden'});
      await composer.getByRole('button',{name:'Save inspiration',exact:true}).click();
    }
    await composer.waitFor({state:'hidden'});const after=await (await page.request.get(`${origin}/fixture`)).json();
    assert.equal(after.inspirations,before.inspirations+1,'Exactly one inspiration is kept');
    if(fault==='save-response')assert.equal(posts,2,'The unresolved replay is settled by GET, without a third POST');
    if(fault==='second-upload'){assert.equal(after.attachments,before.attachments+2);assert.equal(after.objects,before.objects+2);}
    await page.reload();await page.locator('.jar-mouth-rest').waitFor({state:'visible'});
    const restarted=await (await page.request.get(`${origin}/fixture`)).json();assert.equal(restarted.inspirations,after.inspirations);
    const uploads=await Promise.all(uploadChecks);
    if(fault==='second-upload'){
      const expected=createHash('sha256').update(imageBytes).digest('hex');assert.equal(uploads.length,3);
      assert.ok(uploads.every(upload=>!upload.cookie&&!upload.authorization&&upload.type==='image/png'&&upload.bytes===imageBytes.length&&upload.sha256===expected),'Signed PUT sends only the exact file bytes/type and no WAKA credentials');
    }
    results.push({fault,draftPreserved:true,confirmedSaves:1,duplicates:0,posts,reloadStable:true,uploads});await context.close();
  }
  await writeFile(resolve(output,'audit.json'),JSON.stringify({providerNetworkCalls:0,results},null,2));console.log(JSON.stringify({output,cases:results.length}));
}catch(error){
  if(lastPage&&!lastPage.isClosed()){
    await lastPage.screenshot({path:resolve(output,'failure.png')});
    await writeFile(resolve(output,'failure.json'),JSON.stringify({fault:lastFault,posts:lastPosts,url:lastPage.url(),text:await lastPage.locator('body').innerText()},null,2));
  }
  throw error;
}finally{await browser.close();}
