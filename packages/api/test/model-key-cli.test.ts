/** WHAT THIS MOCKS, AND WHY: child-process `fetch` supplies synthetic key
 * metadata or private errors. The real CLI/policy run without external access. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
const script=fileURLToPath(new URL('../../../scripts/verify-model-key-limit.mjs',import.meta.url));
function run(fetchSource:string,args=['--limit-usd=10','--reset=monthly']){
  return spawnSync(process.execPath,['--input-type=module','-e',`globalThis.fetch=${fetchSource};process.argv=${JSON.stringify(['node',script,...args])};await import(${JSON.stringify(script)});`],
    {env:{...process.env,OPENROUTER_API_KEY:'PRIVATE_KEY'},encoding:'utf8'});
}
it('a missing approved policy refuses before provider access',()=>{
  const result=run('async()=>{console.log("UNEXPECTED_NETWORK");throw new Error("PRIVATE_KEY");}',[]);
  expect(result.status).toBe(1);expect(result.stderr).toContain('explicit positive');expect(result.stdout+result.stderr).not.toMatch(/UNEXPECTED_NETWORK|PRIVATE_KEY/);
});
it('valid metadata returns only scoped limit facts',()=>{
  const result=run('async()=>new Response(JSON.stringify({data:{limit:5,limit_reset:"monthly",include_byok_in_limit:true,label:"PRIVATE_LABEL",creator_user_id:"PRIVATE_USER"}}))');
  expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({limitUsd:5,separateStageKeysVerified:false,geminiLimitsVerified:false});
  expect(result.stdout+result.stderr).not.toMatch(/PRIVATE_KEY|PRIVATE_LABEL|PRIVATE_USER/);
});
it('network errors cannot masquerade as safe policy errors to disclose credentials',()=>{
  const result=run('async()=>{throw new Error("Provider key policy PRIVATE_KEY");}');
  expect(result.status).toBe(1);expect(result.stderr.trim()).toBe('Provider key verification failed');
});
