/** WHAT THIS MOCKS, AND WHY: actual SST initializer expressions run with local
 * `sst.Secret` and resource-value stand-ins; no cloud API or real key is used.
 * `launch` models the secret subprocess stdin/argv boundary, not SST uptime.
 * CLI audit coverage uses the existing explicit executable-fixture transport. */
import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import ts from 'typescript';
import profile from '../../../infra/gpt61-development.json';
import {TEXT_TASK_ENV,nativeGptTask} from '../src/lib/model-routing';
import {executeAuditCli} from './helpers/audit-cli';
const root=resolve(__dirname,'../../..'),source=readFileSync(resolve(root,'sst.config.ts'),'utf8');
const ast=ts.createSourceFile('sst.config.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function initializer(name:string){let expression='';const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)expression=n.initializer!.getText(ast);ts.forEachChild(n,walk);};walk(ast);if(!expression)throw Error('Missing tested SST initializer');return expression;}
it('executes the real run declarations in order, rejecting the previous stage-predicate TDZ',()=>{
 const declarations:ts.VariableDeclaration[]=[];
 const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&['isDevelopmentDomain','openAiApiKey'].includes(n.name.getText(ast)))declarations.push(n);ts.forEachChild(n,walk);};walk(ast);
 expect(declarations).toHaveLength(2);
 const run=(ordered:ts.VariableDeclaration[],stage:string)=>{
  const created:string[]=[];class Secret{constructor(name:string){created.push(name);}}
  // Execute actual declarations, without supplying a precomputed stage predicate.
  Function('sst','$app',ordered.map(n=>'const '+n.getText(ast)+';').join('\n')+'\nreturn openAiApiKey;')({Secret},{stage});return created;
 };
 for(const stage of ['development','dev','production','local'])expect(run(declarations,stage)).toEqual(['development','dev'].includes(stage)?['OpenAiApiKey']:[]);
 const oldOrder=[declarations.find(n=>n.name.getText(ast)==='openAiApiKey')!,declarations.find(n=>n.name.getText(ast)==='isDevelopmentDomain')!];
 expect(()=>run(oldOrder,'development')).toThrow(ReferenceError);
});
it('executes the real stage condition: only development creates the new secret',()=>{
 for(const dev of [false,true]){const created:string[]=[];class Secret{constructor(name:string){created.push(name);}}
  const value=Function('isDevelopmentDomain','sst',`return (${initializer('openAiApiKey')});`)(dev,{Secret});
  expect(created).toEqual(dev?['OpenAiApiKey']:[]);expect(Boolean(value)).toBe(dev);
 }
});
it('executes the actual environment initializer for production and dev without leaking key scope',()=>{
 for(const dev of [false,true]){
  const bindings={developmentGpt:profile,openAiApiKey:dev?{value:'SYNTHETIC_OPENAI'}:undefined,
   googleClientId:{value:'google'},googleClientSecret:{value:'google-secret'},sessionSecret:{value:'session'},jwtSecret:{value:'jwt'},dbConnectionUrl:{value:'db'},geminiApiKey:{value:'gemini'},openRouterApiKey:{value:'or'},attachmentsBucket:{name:'bucket'},vaultBucket:{name:'vault'},AWS_REGION:'us-west-2',publicApiUrl:undefined,publicWebUrl:undefined,isDevelopmentDomain:dev,$app:{stage:dev?'development':'production'},process:{env:{}}};
  const env=Function(...Object.keys(bindings),`return (${initializer('runtimeEnvironment')});`)(...Object.values(bindings));
  if(dev){expect(env).toMatchObject(profile);expect(env.OPENAI_API_KEY).toBe('SYNTHETIC_OPENAI');}
  else{expect(env).not.toHaveProperty('OPENAI_API_KEY');expect(env).not.toHaveProperty('WAKA_GENERATION_PROVIDER');expect(env.WAKA_MODEL_CHAT).toBe('deepseek/deepseek-v4.1-flash-1017');expect(env.WAKA_MODEL_SYNTHESIZE).toBe('openai/gpt-6.1-terra');}
 }
 expect(source.match(/OPENAI_API_KEY:/g)).toHaveLength(1);
 expect(source.match(/\.\.\.runtimeEnvironment/g)).toHaveLength(2);expect(source.match(/environment: runtimeEnvironment/g)).toHaveLength(1);
 for(const task of Object.keys(TEXT_TASK_ENV) as Array<keyof typeof TEXT_TASK_ENV>){const config=nativeGptTask(task);expect(config.model).toBe(task==='synthesize'?'gpt-6.1-sol':'gpt-6.1-terra');expect(config.effort).toBe(task==='synthesize'?'medium':'low');}
});
it('sends the new secret through stdin, rejects prod, and keeps child diagnostics private',async()=>{
 const {setDevelopmentOpenAiSecret}=await import(/* @vite-ignore */resolve(root,'scripts/set-development-openai-secret.mjs'));
 const run=(status:number)=>{let input='';const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});child.stdin.on('data',b=>input+=String(b));child.stdin.on('finish',()=>{child.stderr.write('PRIVATE_KEY_AND_PROVIDER_CANARY');queueMicrotask(()=>child.emit('close',status));});const launch=vi.fn(()=>child);return {launch,getInput:()=>input};};
 const success=run(0);expect((await setDevelopmentOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'development',launch:success.launch})).passed).toBe(true);
 expect(success.getInput()).toBe('SYNTHETIC_PRIVATE_KEY');const [command,args,options]=success.launch.mock.calls[0] as unknown as [string,string[],any];
 expect(command).toBe('pnpm');expect(args).toEqual(['sst','secret','set','OpenAiApiKey','--stage','development']);expect(options.env).not.toHaveProperty('OPENAI_API_KEY');expect(JSON.stringify(args)).not.toContain('SYNTHETIC_PRIVATE_KEY');
 await expect(setDevelopmentOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'production',launch:success.launch})).rejects.toThrow('explicit dev');
 const fail=run(1);await expect(setDevelopmentOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'development',launch:fail.launch})).rejects.toThrow(/child_exit=1 categories=unknown/);
 await expect(setDevelopmentOpenAiSecret({key:'SYNTHETIC_PRIVATE_KEY',stage:'dev',launch:()=>{throw Error('PRIVATE_START_ERROR');}})).rejects.toThrow(/^Development OpenAI secret setup: child_start_failed$/);
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
 const read=(args:string[])=>args[0]==='sts'?{Account:'123456789012'}:{FunctionName:args.at(-1),FunctionArn:`arn:aws:lambda:us-west-2:123456789012:function:${args.at(-1)}`,Environment:{Variables:{...env,...(transport[String(args.at(-1))]===undefined?{}:{WAKA_DB_PREPARED_QUERIES:transport[String(args.at(-1))]})}}};return {outputs,expected,env,transport,read};
}
it('audits all three actual model-runtime bindings and refuses missing/wrong profile/key/identity',async()=>{
 const {auditDevelopmentGpt}=await import(/* @vite-ignore */resolve(root,'scripts/dev-gpt-config-audit.mjs'));
 const accepted=auditDevelopmentGpt(auditFixture());expect(accepted.passed).toBe(true);expect(Object.keys(accepted.checks)).toHaveLength(22);
 for(const [role,value] of [['api',undefined],['api','0'],['worker','true'],['principle','1']]){const f=auditFixture();f.transport[String(role)]=value;const report=auditDevelopmentGpt(f);expect(report.passed).toBe(false);expect(report.checks[role==='principle'?'principleRefreshDatabaseTransport':role+'DatabaseTransport']).toBe(false);}
 for(const patch of [{OPENAI_API_KEY:'wrong'},{WAKA_MODEL_CHAT:'deepseek/deepseek-v4.1-flash-1017'},{WAKA_MODEL_SYNTHESIZE:'gpt-6.1-terra'},{WAKA_GENERATION_PROVIDER:'openrouter'},{SST_RESOURCE_App:'{}'}]){const f=auditFixture();Object.assign(f.env,patch);const r=auditDevelopmentGpt(f);expect(r.passed).toBe(false);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_KEY|PRIVATE_DB/);}
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
  const env=Function('isDevelopmentDomain','runtimeEnvironment','jobWakeGroup','jobWakeRole','backgroundWorker',`return (${environment(name)});`)(isDevelopmentDomain,{WAKA_STAGE:isDevelopmentDomain?'development':'production'},{name:'group'},{arn:'role'},{name:'worker'});
  expect(env.WAKA_DB_PREPARED_QUERIES).toBe(isDevelopmentDomain?'1':undefined);
 }
 expect(initializer('runtimeEnvironment')).not.toContain('WAKA_DB_PREPARED_QUERIES');
 expect(initializer('principleRefresh')).not.toContain('WAKA_DB_PREPARED_QUERIES');
 // A new opt-in elsewhere must be explicitly reviewed, never inherited.
 expect(source.match(/WAKA_DB_PREPARED_QUERIES:/g)).toHaveLength(2);
});
