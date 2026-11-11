import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

const root=resolve(__dirname,'../../..');
const require=createRequire(import.meta.url);
// YAML is an existing Vite dependency; use that installed tooling parser,
// rather than a regex that could miss a mis-indented production mutation job.
const fromVitest=createRequire(require.resolve('vitest/package.json'));
const fromVite=createRequire(fromVitest.resolve('vite/package.json'));
const {parse}=fromVite('yaml');
const production=parse(readFileSync(resolve(root,'.github/workflows/deploy.yml'),'utf8'));
const ci=parse(readFileSync(resolve(root,'.github/workflows/ci.yml'),'utf8'));
const load=(file:string)=>import(/* @vite-ignore */ resolve(root,'scripts',file));
const sha='a'.repeat(40),other='b'.repeat(40);

it.each(['failure','cancelled','skipped','',undefined])('refuses production operations after CI result %s',async checkResult=>{
  const {assertProductionRelease}=await load('release-policy.mjs');
  expect(()=>assertProductionRelease({checkResult,expectedSha:sha,actualSha:sha})).toThrow('successful CI');
});
it('accepts only an exact immutable successful checked commit',async()=>{
  const {assertProductionRelease}=await load('release-policy.mjs');
  expect(()=>assertProductionRelease({checkResult:'success',expectedSha:sha,actualSha:sha})).not.toThrow();
  for(const [expectedSha,actualSha] of [[sha,other],['main',sha],['a'.repeat(12),sha],[sha,'main']])expect(()=>assertProductionRelease({checkResult:'success',expectedSha,actualSha})).toThrow();
});
it('gates EVERY production mutation under successful reusable CI and the same SHA',()=>{
  expect(Object.keys(production.jobs)).toEqual(['check','deploy']);
  expect(production.jobs.check.uses).toBe('./.github/workflows/ci.yml');
  expect(production.jobs.check.with.checkout_sha).toBe('${{ github.sha }}');
  const job=production.jobs.deploy;
  expect(job.needs).toBe('check');expect(job.if).toBe("${{ needs.check.result == 'success' }}");
  expect(job.env.SST_STAGE).toBe('production');expect(production.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  expect(production.concurrency['cancel-in-progress']).toBe(false);
  const checkout=job.steps.find((s:any)=>s.uses==='actions/checkout@v4');expect(checkout.with.ref).toBe('${{ github.sha }}');
  const guard=job.steps.findIndex((s:any)=>s.run==='node scripts/verify-release-commit.mjs');expect(guard).toBeGreaterThan(0);
  expect(job.steps[guard].env.RELEASE_CHECK_RESULT).toBe('${{ needs.check.result }}');
  const mutations=job.steps.map((s:any,i:number)=>({s,i})).filter(({s}:any)=>/secret set|db:migrate|sst deploy|update-distribution|change-resource-record-sets/.test(s.run??''));
  expect(mutations).toHaveLength(5);
  for(const {s,i} of mutations){expect(i).toBeGreaterThan(guard);expect(s.if??'').not.toMatch(/always|failure|cancelled/);expect(s.if).toContain('!inputs.preview_only');}
  for(const j of Object.values(ci.jobs) as any[])for(const step of j.steps??[])if(step.uses==='actions/checkout@v4')expect(step.with.ref).toBe('${{ inputs.checkout_sha || github.sha }}');
});
it('the CLI refuses a mismatched ref without echoing environment secrets',()=>{
  const p=spawnSync(process.execPath,[resolve(root,'scripts/verify-release-commit.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,EXPECTED_RELEASE_SHA:sha,RELEASE_CHECK_RESULT:'success',SECRET_PROBE:'DO_NOT_PRINT'}});
  expect(p.status).toBe(1);expect(p.stdout+p.stderr).not.toContain('DO_NOT_PRINT');
});
it('wires explicit stage options without defaulting privacy or alert destinations',()=>{
  const development=parse(readFileSync(resolve(root,'.github/workflows/deploy-dev.yml'),'utf8'));
  for(const key of ['WAKA_OPENROUTER_DATA_COLLECTION','WAKA_OPENROUTER_REQUIRE_ZDR','WAKA_OPERATIONS_ALERT_TOPIC_ARN','WAKA_ALERT_SNS_TOPIC_ARN']){
    expect(production.jobs.deploy.env[key]).toBe('${{ vars.'+key+'_PRODUCTION }}');
    expect(development.env[key]).toBe('${{ vars.'+key+'_DEVELOPMENT }}');
  }
});
it('reconciles only source-established values and same-stage credentials, preserving existing values',async()=>{
  const {stageEnvAdditions,redactedStageInventory}=await load('stage-env-policy.mjs');
  const current={AUTH_SECRET:'PROD_AUTH_PRIVATE',AWS_ACCESS_KEY_ID_APP:'PROD_ACCESS_PRIVATE',AWS_SECRET_ACCESS_KEY_APP:'PROD_SECRET_PRIVATE',PUBLIC_WEB_URL:'https://custom.example',WAKA_OPENROUTER_REQUIRE_ZDR:'1'};
  const add=stageEnvAdditions('production',current);
  expect(add.AUTH_SECRET).toBeUndefined();expect(add.PUBLIC_WEB_URL).toBeUndefined();expect(add.WAKA_OPENROUTER_REQUIRE_ZDR).toBeUndefined();
  expect(add.AWS_ACCESS_KEY_ID).toBe(current.AWS_ACCESS_KEY_ID_APP);expect(add.AWS_SECRET_ACCESS_KEY).toBe(current.AWS_SECRET_ACCESS_KEY_APP);
  expect(add.WAKA_CONVERSATION_REPLIES).toBe('1');expect(add.WAKA_TRUSTED_PROXY_HOPS).toBe('');expect(add.ATTACHMENTS_BUCKET).toBe('');
  expect(JSON.stringify(redactedStageInventory('production',current,add))).not.toMatch(/PROD_AUTH_PRIVATE|PROD_ACCESS_PRIVATE|PROD_SECRET_PRIVATE|custom\.example/);
});
it('rejects invalid privacy/destination settings without manufacturing missing choices',async()=>{
  const {validateStageOptions}=await load('stage-env-policy.mjs');
  expect(()=>validateStageOptions({})).not.toThrow();
  for(const x of [{WAKA_OPENROUTER_DATA_COLLECTION:'allow'},{WAKA_OPENROUTER_REQUIRE_ZDR:'yes'},{WAKA_OPERATIONS_ALERT_TOPIC_ARN:'https://example.test'},{WAKA_TRUSTED_PROXY_HOPS:'guess'}])expect(()=>validateStageOptions(x)).toThrow();
});

it('preview has no route into any production mutation and supplies only the missing proposed secret in memory',()=>{
 const preview=production.jobs.deploy.steps.find((s:any)=>s.run==='node scripts/preview-production.mjs');
 expect(preview.if).toBe('${{ inputs.preview_only }}');
 expect(preview.env.SST_SECRET_OpenRouterApiKey).toBe('${{ secrets.OPENROUTER_API_KEY }}');
 expect(readFileSync(resolve(root,'scripts/preview-production.mjs'),'utf8')).not.toMatch(/secret set|db:migrate|sst deploy|change-resource-record-sets/);
});
