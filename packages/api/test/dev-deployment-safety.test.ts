import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
const root=resolve(__dirname,'../../..'),require=createRequire(import.meta.url),fromVitest=createRequire(require.resolve('vitest/package.json')),fromVite=createRequire(fromVitest.resolve('vite/package.json')),{parse}=fromVite('yaml');
const dev=parse(readFileSync(resolve(root,'.github/workflows/deploy-dev.yml'),'utf8'));
const evaluate=(expression:any,context:any)=>typeof expression==='string'?runInNewContext(expression.slice(3,-2),context):expression;
function context(event:string,verify=false,result='success'){return {github:{event_name:event,sha:'a'.repeat(40)},inputs:{verify_only:verify},needs:{check:{result}}};}
it.each([['push',false],['workflow_dispatch',false]])('never cancels an active mutable %s run or automatically clears its stage lock',event=>{
 const c=context(event as string);expect(evaluate(dev.concurrency.group,c)).toBe('deploy-dev');expect(evaluate(dev.concurrency['cancel-in-progress'],c)).toBe(false);
 const steps=Object.values(dev.jobs).flatMap((j:any)=>j.steps??[]);expect(steps.some((s:any)=>/\bsst\s+unlock\b/.test(s.run??''))).toBe(false);
});
it('keeps read-only verification separate and supersedable without entering any mutation job',()=>{
 const c=context('workflow_dispatch',true);expect(evaluate(dev.concurrency.group,c)).toBe('verify-dev');expect(evaluate(dev.concurrency['cancel-in-progress'],c)).toBe(true);
 expect(evaluate(dev.jobs.verify.if,c)).toBe(true);expect(evaluate(dev.jobs.check.if,c)).toBe(false);expect(evaluate(dev.jobs.deploy.if,c)).toBe(false);
 expect(dev.jobs.verify.steps.some((s:any)=>/sst deploy|db:migrate|secret set|sst unlock/.test(s.run??''))).toBe(false);
});
it.each(['failure','cancelled','skipped',''])('refuses the entire mutable job after check result %s',result=>{
 expect(dev.jobs.deploy.needs).toBe('check');expect(evaluate(dev.jobs.deploy.if,context('push',false,result))).toBe(false);
 expect(evaluate(dev.jobs.deploy.if,context('workflow_dispatch',false,result))).toBe(false);
});
it('checks and deploys the same immutable event SHA',()=>{
 expect(dev.jobs.check.with.checkout_sha).toBe('${{ github.sha }}');
 const checkout=dev.jobs.deploy.steps.find((s:any)=>s.uses==='actions/checkout@v4');expect(checkout.with.ref).toBe('${{ github.sha }}');
 expect(evaluate(dev.jobs.deploy.if,context('push'))).toBe(true);expect(evaluate(dev.jobs.deploy.if,context('workflow_dispatch'))).toBe(true);
});
