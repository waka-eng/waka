/** WHAT THIS MOCKS, AND WHY (gate G6): `tools/embeddings/test_operator.py`
 * replaces subprocess AWS/Node seams with fixed attestations. The actual
 * built Node operator runs refusal cases before SQL/fetch/once markers.
 * No provider, AWS, database, credential or owner content is accessed. */
import {afterAll,beforeAll,expect,it} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {EMBEDDING_2_SPACE} from './embedding-2-space.js';
let folder:string,bundle:string,sha:string;
const root=resolve(process.cwd(),'../..'),env={PATH:process.env.PATH??'',LANG:'C.UTF-8'};
beforeAll(async()=>{await mkdir('/tmp/waka-embedding-2-20261114',{recursive:true});folder=await mkdtemp('/tmp/waka-embedding-2-20261114/operator-cli-');const result=JSON.parse(execFileSync(process.execPath,[join(root,'tools/embeddings/build-shadow-operator.mjs'),folder],{cwd:root,env,encoding:'utf8'}));sha=result.bundleSha256;bundle=join(folder,'shadow-index-'+sha+'.mjs');});
afterAll(async()=>{if(folder)await rm(folder,{recursive:true,force:true});});
function run(args:string[],body?:unknown){const r=spawnSync(process.execPath,[bundle,...args],{input:body===undefined?'':JSON.stringify(body),env,encoding:'utf8',timeout:5000});expect(r.status).toBe(1);expect(r.stdout).not.toContain('PRIVATE_SYNTHETIC');return JSON.parse(r.stdout);}
it('refuses absent/exact-wrong execution hashes before input or SQL',()=>{
 expect(run([])).toMatchObject({passed:false,phase:'approval',sqlMayHaveStarted:false});
 expect(run(['--execute','--approved-sha','0'.repeat(64)])).toMatchObject({passed:false,phase:'approval',sqlMayHaveStarted:false});
});
it('refuses malformed or untrusted target input without echoing credentials or starting SQL',()=>{
 expect(run(['--execute','--approved-sha',sha],{apiKey:'PRIVATE_SYNTHETIC_KEY'})).toMatchObject({passed:false,phase:'input',sqlMayHaveStarted:false});
});
it('checks the independent approved target fingerprint in the actual built CLI before opening SQL',()=>{
 const manifest={version:'embedding2-shadow-v1',accountId:randomUUID(),profiles:[{id:randomUUID(),epoch:'0'}],targetSpace:EMBEDDING_2_SPACE.id,approvedDbSha256:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),maxInventoryCells:1,maxCellsPerInvocation:1,maxRequests:1,maxFormattedInputBytes:100,maxDurationMs:20000,operationalAllowanceUsd:.01};
 const body={mode:'D0',invocationId:randomUUID(),manifest,manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),dbUrl:'postgres://synthetic:PRIVATE_SYNTHETIC_PASSWORD@ep-synthetic-pooler.us-east-1.aws.neon.tech/synthetic?sslmode=require',privacy:{dataCollection:null,requireZdr:null},attestation:{accountId:'182498323408',stage:'development',workerArn:'arn:aws:lambda:us-west-2:182498323408:function:waka-development-BackgroundWorkerFunction-xxbrbmcx',appName:'waka',appStage:'development'}};
 expect(run(['--execute','--approved-sha',sha],body)).toMatchObject({passed:false,phase:'target',code:'identity',sqlMayHaveStarted:false});
});
it('exercises target-attesting wrapper success and refusal boundaries without any external subprocess',()=>{
 const r=spawnSync('python3',[join(root,'tools/embeddings/test_operator.py')],{cwd:root,env,encoding:'utf8',timeout:5000});expect(r.status,r.stderr).toBe(0);expect(r.stdout).not.toContain('PRIVATE');
});
