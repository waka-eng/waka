/** WHAT THIS MOCKS, AND WHY: actual SST initializer expressions run with local
 * `sst.Secret` and resource-value stand-ins; no cloud API or real key is used.
 * `launch` models the secret subprocess stdin/argv boundary, not SST uptime.
 * CLI audit coverage uses the existing explicit executable-fixture transport. */
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import profile from '../../../infra/model-profile.json';
import {TEXT_TASK_ENV,nativeGptTask} from '../src/lib/model-routing';
import {executeAuditCli} from './helpers/audit-cli';
afterEach(()=>vi.unstubAllEnvs());
const root=resolve(__dirname,'../../..'),source=readFileSync(resolve(root,'sst.config.ts'),'utf8');
const ast=ts.createSourceFile('sst.config.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function initializer(name:string){let expression='';const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)expression=n.initializer!.getText(ast);ts.forEachChild(n,walk);};walk(ast);if(!expression)throw Error('Missing tested SST initializer');return expression;}
it('executes the real run declarations in order, rejecting the previous stage-predicate TDZ',()=>{
 const declarations:ts.VariableDeclaration[]=[];
 const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&['isDevelopmentDomain','isModelProfileStage','openAiApiKey'].includes(n.name.getText(ast)))declarations.push(n);ts.forEachChild(n,walk);};walk(ast);
 expect(declarations).toHaveLength(3);
 const run=(ordered:ts.VariableDeclaration[],stage:string)=>{
  const created:string[]=[];class Secret{constructor(name:string){created.push(name);}}
  // Execute actual declarations, without supplying a precomputed stage predicate.
  Function('sst','$app',ordered.map(n=>'const '+n.getText(ast)+';').join('\n')+'\nreturn openAiApiKey;')({Secret},{stage});return created;
 };
 for(const stage of ['development','dev','production','local'])expect(run(declarations,stage)).toEqual(['development','dev','production'].includes(stage)?['OpenAiApiKey']:[]);
 const oldOrder=[declarations.find(n=>n.name.getText(ast)==='openAiApiKey')!,...declarations.filter(n=>n.name.getText(ast)!=='openAiApiKey')];
 expect(()=>run(oldOrder,'development')).toThrow(ReferenceError);
});
it('creates the existing secret only for explicit model-profile stages',()=>{
 for(const enabled of [false,true]){const created:string[]=[];class Secret{constructor(name:string){created.push(name);}}
  const value=Function('isModelProfileStage','sst',`return (${initializer('openAiApiKey')});`)(enabled,{Secret});
  expect(created).toEqual(enabled?['OpenAiApiKey']:[]);expect(Boolean(value)).toBe(enabled);
 }
});
it('executes the actual environment initializer for production and dev without leaking key scope',()=>{
 for(const dev of [false,true]){
  const bindings={modelProfile:profile,openAiApiKey:{value:'SYNTHETIC_OPENAI'},
   googleClientId:{value:'google'},googleClientSecret:{value:'google-secret'},sessionSecret:{value:'session'},jwtSecret:{value:'jwt'},dbConnectionUrl:{value:'db'},geminiApiKey:{value:'gemini'},openRouterApiKey:{value:'or'},attachmentsBucket:{name:'bucket'},vaultBucket:{name:'vault'},AWS_REGION:'us-west-2',publicApiUrl:undefined,publicWebUrl:undefined,isDevelopmentDomain:dev,$app:{stage:dev?'development':'production'},process:{env:{}}};
  const env=Function(...Object.keys(bindings),`return (${initializer('runtimeEnvironment')});`)(...Object.values(bindings));
  expect(env).toMatchObject(profile);expect(env.OPENAI_API_KEY).toBe('SYNTHETIC_OPENAI');
 }
 expect(source.match(/OPENAI_API_KEY:/g)).toHaveLength(1);
 expect(source.match(/\.\.\.runtimeEnvironment/g)).toHaveLength(2);expect(source.match(/environment: runtimeEnvironment/g)).toHaveLength(1);
 for(const task of Object.keys(TEXT_TASK_ENV) as Array<keyof typeof TEXT_TASK_ENV>){const config=nativeGptTask(task);expect(config.model).toBe(task==='synthesize'?'gpt-6.1-sol':'gpt-6.1-terra');expect(config.effort).toBe(task==='synthesize'?'medium':'low');}
});
it('sends the same secret through stdin for exact supported stages and keeps child diagnostics private',async()=>{
 const {setOpenAiSecret}=await import(/* @vite-ignore */resolve(root,'scripts/set-openai-secret.mjs'));
 const run=(status:number)=>{let input='';const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});child.stdin.on('data',b=>input+=String(b));child.stdin.on('finish',()=>{child.stderr.write('PRIVATE_KEY_AND_PROVIDER_CANARY');queueMicrotask(()=>child.emit('close',status));});const launch=vi.fn(()=>child);return {launch,getInput:()=>input};};
 for(const name of ['OPENAI_API_KEY','OPENAI_API_KEY_DEVELOPMENT','OPENAI_API_KEY_PRODUCTION','SST_SECRET_OpenAiApiKey'])vi.stubEnv(name,'SYNTHETIC_PRIVATE_KEY');
 const success=run(0);expect((await setOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'development',launch:success.launch})).passed).toBe(true);
 expect(success.getInput()).toBe('SYNTHETIC_PRIVATE_KEY');const [command,args,options]=success.launch.mock.calls[0] as unknown as [string,string[],any];
 expect(command).toBe('pnpm');expect(args).toEqual(['sst','secret','set','OpenAiApiKey','--stage','development']);for(const name of ['OPENAI_API_KEY','OPENAI_API_KEY_DEVELOPMENT','OPENAI_API_KEY_PRODUCTION','SST_SECRET_OpenAiApiKey'])expect(options.env).not.toHaveProperty(name);expect(JSON.stringify(args)).not.toContain('SYNTHETIC_PRIVATE_KEY');
 const prod=run(0);expect((await setOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'production',launch:prod.launch})).stage).toBe('production');expect(prod.getInput()).toBe('SYNTHETIC_PRIVATE_KEY');expect(prod.launch.mock.calls[0]![1]).toEqual(['sst','secret','set','OpenAiApiKey','--stage','production']);
 for(const stage of ['', 'local','prod',' production'])await expect(setOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage,launch:success.launch})).rejects.toThrow('explicit development/dev/production');
 for(const key of ['', 'a'.repeat(4097),'SYNTHETIC\nPRIVATE'])await expect(setOpenAiSecret({key,stage:'production',launch:success.launch})).rejects.toThrow('missing or malformed');
 const fail=run(1);await expect(setOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'development',launch:fail.launch})).rejects.toThrow(/child_exit=1 categories=unknown/);
 await expect(setOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'dev',launch:()=>{throw Error('PRIVATE_START_ERROR');}})).rejects.toThrow(/^OpenAI secret setup: child_start_failed$/);
});
it('limits the development Actions key to the three setup/audit steps',()=>{
 const workflow=readFileSync(resolve(root,'.github/workflows/deploy-dev.yml'),'utf8');
 const steps=workflow.split(/\n      - name: /).slice(1);
 const exposed=steps.filter(step=>step.includes('secrets.OPENAI_API_KEY_DEVELOPMENT'));
 expect(exposed.map(step=>step.split('\n')[0])).toEqual(['Validate AWS deployment credentials','Set development OpenAI secret through stdin','Verify deployed chat configuration']);
 expect(workflow.match(/secrets\.OPENAI_API_KEY_DEVELOPMENT/g)).toHaveLength(3);
 expect(workflow).not.toContain('secrets.OPENAI_API_KEY }}');
 expect(workflow.slice(0,workflow.indexOf('\n    steps:'))).not.toContain('OPENAI_API_KEY');
});
function auditFixture(){
 const outputs={apiFunctionName:'api',backgroundWorkerFunctionName:'worker',principleRefreshFunctionName:'principle'},expected={stage:'development',openAi:'PRIVATE_KEY',database:'PRIVATE_DB',replies:'1'};
 const env={...profile,OPENAI_API_KEY:expected.openAi,DB_CONNECTION_URL:expected.database,WAKA_STAGE:'development',WAKA_CONVERSATION_REPLIES:'1',SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'development'}),WAKA_BACKGROUND_WORKER_FUNCTION:'worker'};
 const transport:Record<string,unknown>={api:'1',worker:'1'};
 const read=(args:string[])=>args[0]==='sts'?{Account:'123456789012'}:{FunctionName:args.at(-1),FunctionArn:`arn:aws:lambda:us-west-2:123456789012:function:${args.at(-1)}`,Environment:{Variables:{...env,...(args.at(-1)==='api'?{WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'1'}:{}),...(transport[String(args.at(-1))]===undefined?{}:{WAKA_DB_PREPARED_QUERIES:transport[String(args.at(-1))]})}}};return {outputs,expected,env,transport,read};
}
it('audits all three actual model-runtime bindings and refuses missing/wrong profile/key/identity',async()=>{
 const {auditDevelopmentGpt}=await import(/* @vite-ignore */resolve(root,'scripts/dev-gpt-config-audit.mjs'));
 const accepted=auditDevelopmentGpt(auditFixture());expect(accepted.passed).toBe(true);expect(Object.keys(accepted.checks).sort()).toEqual(['api','worker','principleRefresh'].flatMap(role=>['Identity','Stage','OpenAiKey','Database','Profile','Chat','DatabaseTransport'].map(field=>role+field)).concat(['workerPointer','newHumanEmbeddingEnrollment']).sort());
 for(const [role,flag] of [['api',undefined],['api','0'],['api','true'],['worker','0'],['worker','1'],['principle','0'],['principle','1']]){const f=auditFixture();const r=auditDevelopmentGpt({...f,read:(args:string[])=>{const row=f.read(args);if(args.at(-1)===role&&'Environment' in row)Object.assign(row.Environment!.Variables,{WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:flag});return row;}});expect(r.passed).toBe(false);expect(r.checks.newHumanEmbeddingEnrollment).toBe(false);}
 for(const [role,value] of [['api',undefined],['api','0'],['worker','true'],['principle','1']]){const f=auditFixture();f.transport[String(role)]=value;const report=auditDevelopmentGpt(f);expect(report.passed).toBe(false);expect(report.checks[role==='principle'?'principleRefreshDatabaseTransport':role+'DatabaseTransport']).toBe(false);}
 for(const patch of [{OPENAI_API_KEY:'wrong'},{WAKA_MODEL_CHAT:'deepseek/deepseek-v4.1-flash-1017'},{WAKA_MODEL_SYNTHESIZE:'gpt-6.1-terra'},{WAKA_GENERATION_PROVIDER:'openrouter'},{SST_RESOURCE_App:'{}'},{WAKA_STAGE:'production'},{SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'})}]){const f=auditFixture();Object.assign(f.env,patch);const r=auditDevelopmentGpt(f);expect(r.passed).toBe(false);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_KEY|PRIVATE_DB/);}
 const wrongExpectedStage=auditFixture();wrongExpectedStage.expected.stage='production';expect(auditDevelopmentGpt(wrongExpectedStage).passed).toBe(false);
 const f=auditFixture();expect(auditDevelopmentGpt({...f,read:()=>({})}).passed).toBe(false);
});
it('executes the audit CLI with isolated fake AWS and emits valid safe failure/success artifacts',async()=>{
 const {auditDevelopmentGpt}=await import(/* @vite-ignore */resolve(root,'scripts/dev-gpt-config-audit.mjs')),f=auditFixture(),responses:Record<string,any>={};
 auditDevelopmentGpt({...f,read:(args:string[])=>{const json=f.read(args);responses[JSON.stringify(args)]={json};return json;}});
 const r=executeAuditCli('dev-gpt-config-audit.mjs',{outputs:f.outputs,responses,env:{OPENAI_API_KEY:f.expected.openAi,DB_CONNECTION_URL:f.expected.database,WAKA_CONVERSATION_REPLIES:'1',SST_STAGE:'development'}});
 expect(r.status).toBe(0);expect(JSON.parse(r.stdout).passed).toBe(true);expect(r.stdout+r.stderr).not.toMatch(/PRIVATE_KEY|PRIVATE_DB/);
});

it('executes actual API/worker environment expressions; default/prod and other consumers stay unprepared',()=>{
 function environment(name:string){let value='';const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name&&n.initializer&&ts.isNewExpression(n.initializer)){const options=n.initializer.arguments?.[1];if(options&&ts.isObjectLiteralExpression(options))for(const p of options.properties)if(ts.isPropertyAssignment(p)&&p.name.getText(ast)==='environment')value=p.initializer.getText(ast);}ts.forEachChild(n,walk);};walk(ast);if(!value)throw Error('Missing runtime environment');return value;}
 for(const isDevelopmentDomain of [false,true])for(const name of ['api','backgroundWorker']){
  const env=Function('isDevelopmentDomain','$app','runtimeEnvironment','jobWakeGroup','jobWakeRole','backgroundWorker',`return (${environment(name)});`)(isDevelopmentDomain,{stage:isDevelopmentDomain?'development':'production'},{WAKA_STAGE:isDevelopmentDomain?'development':'production'},{name:'group'},{arn:'role'},{name:'worker'});
  expect(env.WAKA_DB_PREPARED_QUERIES).toBe(isDevelopmentDomain?'1':undefined);
  expect(env.WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2).toBe(name==='api'?(isDevelopmentDomain?'1':'0'):undefined);
 }
 expect(initializer('runtimeEnvironment')).not.toContain('WAKA_DB_PREPARED_QUERIES');
 expect(initializer('principleRefresh')).not.toContain('WAKA_DB_PREPARED_QUERIES');
 expect(initializer('runtimeEnvironment')).not.toContain('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2');
 expect(initializer('principleRefresh')).not.toContain('WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2');
 // A new opt-in elsewhere must be explicitly reviewed, never inherited.
 expect(source.match(/WAKA_DB_PREPARED_QUERIES:/g)).toHaveLength(2);
});

it('keeps production key exposure step-scoped and refuses a missing key before production operations',()=>{
 const workflow=readFileSync(resolve(root,'.github/workflows/deploy.yml'),'utf8'),steps=workflow.split(/\n      - name: /).slice(1);
 const exposed=steps.filter(step=>step.includes('secrets.OPENAI_API_KEY_PRODUCTION'));
 expect(exposed.map(step=>step.split('\n')[0])).toEqual(['Validate deployment environment','Preview checked production infrastructure','Set production OpenAI secret through stdin','Verify production runtime and cleanup wiring without secrets']);
 expect(workflow.slice(0,workflow.indexOf('\n    steps:'))).not.toContain('OPENAI_API_KEY');
 expect(workflow).not.toContain('secrets.OPENAI_API_KEY }}');
 expect(workflow).toContain('run: node scripts/set-openai-secret.mjs');
 const validation=steps.find(step=>step.startsWith('Validate deployment environment'))!,body=validation.split('        run: |\n')[1]!.split('\n').filter(line=>line.startsWith('          ')).map(line=>line.slice(10)).join('\n');
 const env=Object.fromEntries(['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','AUTH_GOOGLE_ID','AUTH_GOOGLE_SECRET','AUTH_SECRET','JWT_SECRET','DB_CONNECTION_URL','GEMINI_API_KEY','OPENROUTER_API_KEY','WAKA_DISCORD_WEBHOOK_URL'].map(name=>[name,'SYNTHETIC_PRIVATE_VALUE']));
 const missing=spawnSync('/bin/bash',['-c',body],{env,encoding:'utf8'});expect(missing.status).toBe(1);expect(missing.stderr).toContain('OPENAI_API_KEY');expect(missing.stdout+missing.stderr).not.toContain('SYNTHETIC_PRIVATE');
 expect(spawnSync('/bin/bash',['-c',body],{env:{...env,OPENAI_API_KEY:'SYNTHETIC_PRIVATE_VALUE'},encoding:'utf8'}).status).toBe(0);
 for(const operation of ['Preserve current heartbeat','Release legacy CloudFront','Set SST production secrets','Apply production database migrations','Deploy SST production stage'])expect(workflow.indexOf('Validate deployment environment')).toBeLessThan(workflow.indexOf(operation));
});
