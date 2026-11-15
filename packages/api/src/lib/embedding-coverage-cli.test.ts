/** WHAT THIS MOCKS, AND WHY (gate G6): no transport is mocked. Actual built
 * C0 is run only with invalid synthetic target/approval inputs so it must refuse
 * before SQL. Private filesystem output is real and uses synthetic text only. */
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,mkdtemp,stat,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {publishCoverageMetadata} from '../../../../tools/embeddings/coverage-private-report.js';
const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
let dir:string,bundle:string,bundleSha:string;
beforeAll(async()=>{
 dir='/tmp/waka-embedding-2-20261115/c0/unit-cli-'+randomUUID();
 const r=JSON.parse(execFileSync(process.execPath,[root+'/tools/embeddings/build-coverage-operator.mjs',dir],{encoding:'utf8'}));bundleSha=r.bundleSha256;bundle=dir+'/coverage-index-'+bundleSha+'.mjs';expect(r.providerOrQueueRuntimeInputs).toBe(0);
 const inputs=JSON.parse(await readFile(dir+'/build-inputs-'+bundleSha+'.json','utf8'));
 for(const row of inputs.inputs)expect(createHash('sha256').update(await readFile(root+'/'+row.path)).digest('hex')).toBe(row.sha256);
});afterAll(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
function input(){return {manifest:{version:'embedding-coverage-v1',accountId:randomUUID(),profiles:[{id:randomUUID(),epoch:'0',activeSpace:'gemini-embedding-001',activePolicy:'gemini-embedding-001.thresholds.v1',buildingSpace:null,buildingPolicy:null}],targetSpace:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',approvedDbSha256:'6fabf56590aab323e5eacfd976ce05566cde21553297c2edaa3f08d7ea6bebda',expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:10,maxBytes:8388608,maxStatements:100,maxDurationMs:60000,maxLedgerAttempts:100},manifestSha256:'',invocationId:randomUUID(),dbUrl:'PRIVATE_URI_SENTINEL',attestation:{accountId:'182498323408',stage:'development',workerArn:'arn:aws:lambda:us-west-2:182498323408:function:waka-development-BackgroundWorkerFunction-xxbrbmcx',appName:'waka',appStage:'development',executionRegion:'us-east-1',runtimeConfigurationRegion:'us-west-2'}};}
it('refuses absent/mismatching bundle approval with no SQL or unstructured stderr',()=>{
 for(const args of [[],['--execute-reviewed','--approved-sha','0'.repeat(64)]]){
  const r=spawnSync(process.execPath,[bundle,...args],{encoding:'utf8'});expect(r.status).toBe(1);expect(r.stderr).toBe('');expect(JSON.parse(r.stdout)).toMatchObject({passed:false,mode:'C0',phase:'approval',code:'identity',sqlMayHaveStarted:false,providerCalls:0,memoryMutations:0});
 }
});
it('refuses unapproved URI or production identity before any SQL without echoing identifiers/secrets',()=>{
 for(const production of [false,true]){const v=input();if(production)v.attestation.stage='production';v.manifestSha256=createHash('sha256').update(JSON.stringify(v.manifest)).digest('hex');
  const r=spawnSync(process.execPath,[bundle,'--execute-reviewed','--approved-sha',bundleSha],{encoding:'utf8',input:JSON.stringify(v),env:{PATH:process.env.PATH,OPENROUTER_API_KEY:'PRIVATE_FAKE_KEY',AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1'}});
  expect(r.status).toBe(1);expect(r.stderr).toBe('');expect(JSON.parse(r.stdout)).toMatchObject({passed:false,phase:'target',sqlMayHaveStarted:false});for(const secret of ['PRIVATE_URI_SENTINEL','PRIVATE_FAKE_KEY',v.manifest.accountId,v.manifest.profiles[0].id])expect(r.stdout).not.toContain(secret);
 }
});
it('rejects provider/repair fields in its closed input before target/SQL',()=>{
 const v={...input(),apiKey:'PRIVATE_KEY'};v.manifestSha256=createHash('sha256').update(JSON.stringify(v.manifest)).digest('hex');
 const r=spawnSync(process.execPath,[bundle,'--execute-reviewed','--approved-sha',bundleSha],{input:JSON.stringify(v),encoding:'utf8'});expect(JSON.parse(r.stdout)).toMatchObject({passed:false,phase:'input',sqlMayHaveStarted:false});expect(r.stdout).not.toContain('PRIVATE_KEY');
});
it('refuses a west execution environment rather than pretending it is an east shell',()=>{
 const v=input();v.manifestSha256=createHash('sha256').update(JSON.stringify(v.manifest)).digest('hex');
 const r=spawnSync(process.execPath,[bundle,'--execute-reviewed','--approved-sha',bundleSha],{input:JSON.stringify(v),encoding:'utf8',env:{PATH:process.env.PATH,AWS_REGION:'us-west-2',AWS_DEFAULT_REGION:'us-west-2'}});
 expect(JSON.parse(r.stdout)).toMatchObject({passed:false,phase:'target',sqlMayHaveStarted:false,executionRegion:null,runtimeConfigurationRegion:null});
});
it('publishes actual private metadata0600 atomically and never replaces existing contents',async()=>{
 const privateDir=await mkdtemp('/tmp/waka-embedding-coverage-test-'),base=privateDir+'/report';
 try{await publishCoverageMetadata(base,'SYNTHETIC_UUID_METADATA');expect((await stat(base+'.private.json')).mode&0o777).toBe(0o600);
  await expect(publishCoverageMetadata(base,'WRONG_REPLACEMENT')).rejects.toMatchObject({code:'EEXIST'});expect(await readFile(base+'.private.json','utf8')).toBe('SYNTHETIC_UUID_METADATA');await expect(stat(base+'.pending')).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(privateDir,{recursive:true});}
});
