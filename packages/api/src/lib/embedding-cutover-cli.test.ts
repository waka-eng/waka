/** WHAT THIS MOCKS, AND WHY (gate G6): no SQL/provider transport is mocked.
 * Actual keyless bundle/schema runs only preflight or invalid target inputs.
 * Python unit tests fake AWS/subprocess seams; no credentials/network are used. */
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {beforeAll,afterAll,expect,it} from 'vitest';
const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
let dir:string,bundle:string,sha:string;
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
function intent(){return {version:'embedding-cutover-v1',mode:'empty',accountId:randomUUID(),profiles:[{id:randomUUID(),profileType:'human',epoch:'0',generation:'1',frontier:'0',controlPresent:false,coveredVersion:null,buildingSpace:null,buildingPolicy:null}],targetSpace:'waka.embedding.gemini-2.text-retrieval.v1.768.raw',thresholdPolicy:'embedding2.dev-candidates.v1',approvedDbSha256:'6fabf56590aab323e5eacfd976ce05566cde21553297c2edaa3f08d7ea6bebda',expiresAt:new Date(Date.now()+3600000).toISOString(),maxCells:1,maxBytes:8388608,maxStatements:100,maxDurationMs:5000,maxLedgerAttempts:10};}
function preflight(operation:unknown){return spawnSync(process.execPath,[bundle,'--validate-operation','--approved-sha',sha],{encoding:'utf8',input:JSON.stringify({operation})});}
beforeAll(async()=>{
 dir='/tmp/waka-embedding-2-20261115/c1-implementation-r0/unit-cli-'+randomUUID();const r=JSON.parse(execFileSync(process.execPath,[root+'/tools/embeddings/build-cutover-operator.mjs',dir],{encoding:'utf8'}));sha=r.bundleSha256;bundle=dir+'/cutover-index-'+sha+'.mjs';expect(r.providerOrQueueRuntimeInputs).toBe(0);
 const inputs=JSON.parse(await readFile(dir+'/build-inputs-'+sha+'.json','utf8'));for(const v of inputs.inputs)expect(createHash('sha256').update(await readFile(root+'/'+v.path)).digest('hex')).toBe(v.sha256);
});afterAll(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
it('runs actual closed schema and canonical JS/Python bytes without SQL or credential input',()=>{
 const m=intent(),r=preflight(m);expect(r.status).toBe(0);expect(r.stderr).toBe('');expect(JSON.parse(r.stdout)).toMatchObject({passed:true,mode:'preflight',operationKind:'C1',operationSha256:digest(JSON.stringify(m))});
 const py=spawnSync('python3',['-c',"import json,sys;print(json.dumps(json.loads(sys.stdin.read()),ensure_ascii=False,separators=(',',':')),end='')"],{encoding:'utf8',input:JSON.stringify(m)});expect(py.status).toBe(0);expect(py.stdout).toBe(JSON.stringify(m));
});
it('allows only new read authority for expired immutable intent; refuses expired mutation/read and hash/target/unknown-field changes',()=>{
 const m=intent();m.expiresAt='2020-01-01T00:00:00.000Z';expect(preflight(m).status).toBe(1);
 const op={version:'embedding-cutover-read-v1',intent:m,intentSha256:digest(JSON.stringify(m)),approvedDbSha256:m.approvedDbSha256,expiresAt:new Date(Date.now()+3600000).toISOString(),maxDurationMs:5000};
 expect(preflight(op).status).toBe(0);
 for(const extra of [{expiresAt:m.expiresAt},{intentSha256:'f'.repeat(64)},{approvedDbSha256:'f'.repeat(64)},{mode:'C1'},{apiKey:'PRIVATE_SENTINEL'}]){const r=preflight({...op,...extra});expect(r.status).toBe(1);expect(r.stdout+r.stderr).not.toContain('PRIVATE_SENTINEL');}
});
it('refuses unapproved URI/production/missing bundle approval before SQL without raw values',()=>{
 for(const production of [false,true]){const operation=intent();const input={operation,operationSha256:digest(JSON.stringify(operation)),invocationId:randomUUID(),dbUrl:'PRIVATE_URI_SENTINEL',attestation:{accountId:'182498323408',stage:production?'production':'development',workerArn:'arn:aws:lambda:us-west-2:182498323408:function:waka-development-BackgroundWorkerFunction-xxbrbmcx',appName:'waka',appStage:'development',executionRegion:'us-east-1',runtimeConfigurationRegion:'us-west-2'}};
 const r=spawnSync(process.execPath,[bundle,'--execute-reviewed','--approved-sha',sha],{encoding:'utf8',input:JSON.stringify(input),env:{PATH:process.env.PATH,AWS_REGION:'us-east-1',AWS_DEFAULT_REGION:'us-east-1',OPENROUTER_API_KEY:'PRIVATE_FAKE_KEY'}});
 expect(r.status).toBe(1);expect(r.stderr).toBe('');expect(JSON.parse(r.stdout)).toMatchObject({passed:false,phase:'target',sqlMayHaveStarted:false,outcome:'not_started',activationReplayAuthorized:false});for(const v of ['PRIVATE_URI_SENTINEL','PRIVATE_FAKE_KEY',operation.accountId,operation.profiles[0].id])expect(r.stdout).not.toContain(v);
 }
 const r=spawnSync(process.execPath,[bundle],{encoding:'utf8'});expect(r.status).toBe(1);expect(JSON.parse(r.stdout).sqlMayHaveStarted).toBe(false);
});
it('exercises frozen operator ordering, privacy and abnormal-child UNKNOWN handling with local fake tools only',()=>{
 const r=spawnSync('python3',['-m','unittest','tools/embeddings/test_cutover_operator.py'],{cwd:root,encoding:'utf8'});expect(r.status,r.stdout+r.stderr).toBe(0);
});
