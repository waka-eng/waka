import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

it('uses the real pinned CLI: static config import fails; dynamic import reaches app before any provider or run',async()=>{
 const root=resolve(__dirname,'../../..');
 const {classifyPreviewFailure}=await import(/* @vite-ignore */join(root,'scripts/production-preview-diagnostics.mjs'));
 const require=createRequire(realpathSync(join(root,'node_modules/sst/bin/sst.mjs')));
 const binary=require.resolve(`sst-${process.platform}-${process.arch}/bin/sst${process.platform==='win32'?'.exe':''}`);
 const version=JSON.parse(readFileSync(join(root,'node_modules/sst/package.json'),'utf8')).version;
 expect(version).toBe('3.19.3');
 const folder=mkdtempSync(join(tmpdir(),'waka-sst-startup-'));
 try {
  const home=join(folder,'home');mkdirSync(home,{mode:0o700});
  // Deliberately do not inherit real AWS/model/DB credentials or profiles.
  // app() throws before Project.New can return or LoadHome/run can execute.
  // The macOS reproduction additionally denies networking at the OS boundary.
  const env={PATH:process.env.PATH,HOME:home,TMPDIR:folder,
   SST_SKIP_DEPENDENCY_CHECK:'1',SST_TELEMETRY_DISABLED:'1',SST_PRINT_LOGS:'1',NO_COLOR:'1',
   AWS_EC2_METADATA_DISABLED:'true',AWS_SHARED_CREDENTIALS_FILE:join(folder,'no-credentials'),AWS_CONFIG_FILE:join(folder,'no-config')};
  const command=process.platform==='darwin'?'/usr/bin/sandbox-exec':binary;
  const prefix=process.platform==='darwin'?['-p','(version 1) (allow default) (deny network*)',binary]:[];
  const invoke=(args:string[],cwd:string)=>spawnSync(command,[...prefix,...args],{cwd,env,encoding:'utf8',timeout:15000,stdio:'pipe'});
  const check=invoke(['version'],folder);
  expect(check.status).toBe(0);expect((check.stdout+check.stderr).includes('3.19.3')).toBe(true);
  const source=readFileSync(join(root,'sst.config.ts'),'utf8');
  const dynamic="    const { default: scheduledWorkerEvent } = await import('./infra/background-worker-event.json');";
  expect(source.includes(dynamic)).toBe(true);
  expect(source.includes('  app(input) {')).toBe(true);
  const guarded=source.replace('  app(input) {',"  app(input) {\n    throw new Error('WAKA_OFFLINE_APP_REACHED');");
  const previous="import scheduledWorkerEvent from './infra/background-worker-event.json';\n"+guarded.replace(dynamic,'');
  for(const [kind,config] of [['static',previous],['dynamic',guarded]]){
   const cwd=join(folder,kind);mkdirSync(cwd,{mode:0o700});writeFileSync(join(cwd,'sst.config.ts'),config);
   for(const file of ['infra/background-worker-event.json','infra/monitoring-relay-arn.mjs','packages/api/src/monitoring/protocol.ts']){
    const target=join(cwd,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(join(root,file)));
   }
   const result=invoke(['diff','--stage','offline-startup'],cwd),output=result.stdout+result.stderr;
   expect(result.status).toBe(1);expect(result.error===undefined).toBe(true);
   expect(output.includes('ErrTopLevelImport')).toBe(kind==='static');
   if(kind==='static')expect(classifyPreviewFailure(output).categories).toContain('config_top_level_import');
   expect(output.includes('WAKA_OFFLINE_APP_REACHED')).toBe(kind==='dynamic');
   expect(output.includes('loading home')).toBe(false);
  }
 } finally {rmSync(folder,{recursive:true,force:true});}
},40000);
