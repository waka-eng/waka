import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {executeAuditCli} from './helpers/audit-cli';
import modelProfile from '../../../infra/model-profile.json';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-release-audit.mjs'));
function fixture(signupMode='closed'){
 const expected={database:'PRIVATE_DB_DO_NOT_PRINT',openRouter:'PRIVATE_KEY_DO_NOT_PRINT',openAi:'PRIVATE_OPENAI_DO_NOT_PRINT',attachments:'bucket',vault:'vault',signupMode,turnstileSiteKey:'synthetic-public-site-key',turnstileSecret:'PRIVATE_HUMAN_SECRET_DO_NOT_PRINT'};
 const outputs={apiFunctionName:'waka-production-api',backgroundWorkerFunctionName:'waka-production-worker',principleRefreshFunctionName:'waka-production-principle',attachmentsBucket:'bucket',vaultBucket:'vault'};
 const arn='arn:aws:sqs:us-west-2:123456789012:waka-production-events',roleArn='arn:aws:iam::123456789012:role/waka-production-consumer';
 const functionArn='arn:aws:lambda:us-west-2:123456789012:function:AttachmentObjectEventsSubscriberXvxecaFunctionFunction-xztsmknd';
 const consumerEnv={DB_CONNECTION_URL:expected.database,ATTACHMENTS_BUCKET:'bucket',ATTACHMENTS_REGION:'us-west-2',SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'})};
 const mapping={State:'Enabled',BatchSize:1,FunctionResponseTypes:['ReportBatchItemFailures'],EventSourceArn:arn,FunctionArn:functionArn};
 const env={...modelProfile,OPENAI_API_KEY:expected.openAi,SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'}),DB_CONNECTION_URL:expected.database,OPENROUTER_API_KEY:expected.openRouter,WAKA_CONVERSATION_REPLIES:'1',WAKA_STAGE:'production',ATTACHMENTS_BUCKET:'bucket',WAKA_VAULT_BUCKET:'vault',WAKA_BACKGROUND_WORKER_FUNCTION:'waka-production-worker',PUBLIC_WEB_URL:'https://waka.im'};
 const policy={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'s3.amazonaws.com'},Action:'sqs:SendMessage',Resource:arn,Condition:{ArnEquals:{'aws:SourceArn':'arn:aws:s3:::bucket'},StringEquals:{'aws:SourceAccount':'123456789012'}}}]};
 const iam={Statement:[
  {Effect:'Allow',Action:['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes','sqs:GetQueueUrl','sqs:ChangeMessageVisibility'],Resource:arn},
  {Effect:'Allow',Action:'s3:DeleteObject',Resource:'arn:aws:s3:::bucket/*'},
  {Effect:'Allow',Action:'s3:ListBucketVersions',Resource:'arn:aws:s3:::bucket'},
  {Effect:'Allow',Action:'s3:DeleteObjectVersion',Resource:'arn:aws:s3:::bucket/*'},
  {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:'*'},
 ]};
 const trust={Statement:[{Effect:'Allow',Action:'sts:AssumeRole',Principal:{Service:'lambda.amazonaws.com'}}]};
 const managed=[{PolicyArn:'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'}];
 const read=(args:string[])=>{
  if(args[0]==='sts')return {Account:'123456789012'};
  if(args[1]==='get-function-configuration')return args.some(x=>x.includes(':function:'))?{FunctionArn:functionArn,Role:roleArn,Timeout:30,Environment:{Variables:consumerEnv}}:{FunctionName:args.at(-1),FunctionArn:`arn:aws:lambda:us-west-2:123456789012:function:${args.at(-1)}`,Environment:{Variables:{...env,...(args.at(-1)===outputs.apiFunctionName?{WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:'1',WAKA_SIGNUP_ADMISSION:expected.signupMode,...(expected.signupMode==='turnstile'?{WAKA_TURNSTILE_SITE_KEY:expected.turnstileSiteKey,WAKA_TURNSTILE_SECRET:expected.turnstileSecret}:{})}:{})}}};
  if(args[1]==='get-bucket-notification-configuration')return {QueueConfigurations:[{Events:['s3:ObjectCreated:*'],QueueArn:arn}]};
  if(args[1]==='get-queue-url')return {QueueUrl:args.includes('waka-production-dlq')?'dlq':'queue'};
  if(args[1]==='get-queue-attributes')return {Attributes:args.includes('dlq')?{MessageRetentionPeriod:'1209600'}:{Policy:JSON.stringify(policy),VisibilityTimeout:'180',MessageRetentionPeriod:'1209600',RedrivePolicy:JSON.stringify({maxReceiveCount:5,deadLetterTargetArn:'arn:aws:sqs:us-west-2:123456789012:waka-production-dlq'})}};
  if(args[1]==='list-event-source-mappings')return {EventSourceMappings:[mapping]};
  if(args[1]==='get-role')return {Role:{Arn:roleArn,AssumeRolePolicyDocument:trust}};
  if(args[1]==='list-attached-role-policies')return {AttachedPolicies:managed};
  if(args[1]==='list-role-policies')return {PolicyNames:['ScopedConsumer']};
  if(args[1]==='get-role-policy')return {PolicyDocument:iam};
  throw Error('Unexpected read');
 };return {expected,outputs,env,read,policy,iam,managed,trust,arn,roleArn,mapping,consumerEnv,functionArn};
}
it('accepts stage-scoped runtime and durable event wiring without returning credential values',async()=>{
 const {auditProductionRelease}=await load(),f=fixture(),r=auditProductionRelease(f);
 expect(r.passed).toBe(true);expect(Object.keys(r.checks)).toHaveLength(56);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_DB|PRIVATE_KEY/);
 expect(r.checks.sendPolicyScoped).toBe(true);expect(r.checks.cleanupIamIsolated).toBe(true);
 expect(r.actualLatePutExercise).toBe(false);expect(r.externalAlertDeliveryVerified).toBe(false);
});
it('executed release audit preserves detailed gates and names actual failures in stderr',async()=>{
 const {auditProductionRelease}=await load(),f=fixture(),responses:Record<string,any>={};
 f.expected.attachments='waka-production-attachmentsbucket-rceuztkc';f.expected.vault='waka-production-vaultbucket-baskzfwm';
 auditProductionRelease({...f,read:(args:string[])=>{const value=f.read(args);responses[JSON.stringify(args)]={json:value};return value;}});
 const r=executeAuditCli('production-release-audit.mjs',{outputs:f.outputs,responses}),report=JSON.parse(r.stdout);
 expect(r.status).toBe(1);expect(report.checks.apiDatabaseMatches).toBe(false);expect(r.stderr).toContain('apiDatabaseMatches');
 expect(r.stderr).toContain('production-release-audit.json');expect(r.stderr).toContain('Next:');expect(r.stderr).not.toContain('arn:');
 expect(r.stdout+r.stderr).not.toContain('PRIVATE_');
});
it('fails mismatched provider/DB, leaked admin flags, missing notifications and event mapping readiness',async()=>{
 const {auditProductionRelease}=await load();
 for(const patch of [{DB_CONNECTION_URL:'wrong'},{OPENROUTER_API_KEY:'wrong'},{OPENAI_API_KEY:'wrong'},{WAKA_MODEL_PRINCIPLES:'foreign'},{WAKA_AUDIO_PROVIDER:'gemini'},{WAKA_CONVERSATION_REPLIES:'0'},{WAKA_ENABLE_ADMIN_ROUTES:'true'},{WAKA_MODEL_CHAT:'unapproved'}]){
  const f=fixture();Object.assign(f.env,patch);expect(auditProductionRelease(f).passed).toBe(false);
 }
 const f=fixture(),read=f.read;
 expect(auditProductionRelease({...f,read:(args:string[])=>args[1]==='get-bucket-notification-configuration'?{}:read(args)}).passed).toBe(false);
 expect(auditProductionRelease({...f,read:(args:string[])=>args[1]==='list-event-source-mappings'?{EventSourceMappings:[]}:read(args)}).passed).toBe(false);
});
it('refuses legacy broad service send policies, wrong bucket/account and additional allow paths',async()=>{
 const {auditProductionRelease,scopedS3SendPolicy}=await load();
 for(const edit of [
  (s:any)=>{delete s.Condition;},
  (s:any)=>{s.Principal.Service=['sns.amazonaws.com','s3.amazonaws.com','events.amazonaws.com'];},
  (s:any)=>{s.Condition.ArnEquals['aws:SourceArn']='arn:aws:s3:::other';},
  (s:any)=>{s.Condition.StringEquals['aws:SourceAccount']='456';},
  (s:any)=>{s.Action='sqs:*';},
  (s:any)=>{s.Resource='*';},
 ]){
  const f=fixture();edit(f.policy.Statement[0]);expect(auditProductionRelease(f).passed).toBe(false);
 }
 const f=fixture();f.policy.Statement.push({...f.policy.Statement[0]!,Principal:{Service:'sns.amazonaws.com'}});
 expect(scopedS3SendPolicy(f.policy,f.arn,'bucket','123456789012')).toBe(false);
});
it('refuses unneeded bucket CRUD/read, foreign queues, wildcard model permissions and unexpected managed/trust policies',async()=>{
 const {auditProductionRelease}=await load();
 for(const edit of [
  (f:any)=>{f.iam.Statement[1].Action='s3:*';},
  (f:any)=>{f.iam.Statement[1].Action='s3:GetObject';},
  (f:any)=>{f.iam.Statement[1].Resource='arn:aws:s3:::other/*';},
  (f:any)=>{f.iam.Statement[0].Resource='arn:aws:sqs:us-west-2:123456789012:other';},
  (f:any)=>{f.iam.Statement.push({Effect:'Allow',Action:'bedrock:InvokeModel',Resource:'*'});},
  (f:any)=>{f.managed.push({PolicyArn:'arn:aws:iam::aws:policy/AdministratorAccess'});},
  (f:any)=>{f.trust.Statement[0].Principal={AWS:'*'};},
 ]){const f=fixture();edit(f);expect(auditProductionRelease(f).passed).toBe(false);}
});

it('requires every cleanup action on its exact resource and rejects cross-scope grants',async()=>{
 const {auditProductionRelease}=await load();
 for(const action of fixture().iam.Statement.slice(0,4).flatMap(s=>s.Action)){
  const f=fixture();
  f.iam.Statement=f.iam.Statement.map(s=>({...s,Action:[s.Action].flat().filter(a=>a!==action)})).filter(s=>s.Action.length>0);
  expect(auditProductionRelease(f).checks.cleanupIamIsolated,action).toBe(false);
 }
 for(const grant of [
  {Action:'sqs:ReceiveMessage',Resource:'arn:aws:s3:::bucket'},
  {Action:'s3:ListBucketVersions',Resource:'arn:aws:s3:::bucket/*'},
  {Action:'s3:DeleteObjectVersion',Resource:'arn:aws:s3:::bucket'},
  {Action:'s3:DeleteObjectVersion',Resource:'arn:aws:s3:::vault/*'},
  {Action:'s3:ListBucketVersions',Resource:'*'},
  {Action:'s3:DeleteObjectVersion',Resource:'arn:aws:s3:::*/*'},
  {Action:'s3:DeleteObjectVersion',Resource:['arn:aws:s3:::bucket/*','arn:aws:s3:::bucket']},
  {Action:['s3:ListBucketVersions','s3:DeleteObjectVersion'],Resource:'arn:aws:s3:::bucket'},
 ]){
  const f=fixture(),read=f.read;
  const augmented={Statement:[...f.iam.Statement,{Effect:'Allow',...grant}]};
  const report=auditProductionRelease({...f,read:(args:string[])=>args[1]==='get-role-policy'?{PolicyDocument:augmented}:read(args)});
  expect(report.checks.cleanupIamIsolated,JSON.stringify(grant)).toBe(false);
  expect(report.passed).toBe(false);
 }
});

it('accepts the observed generated consumer name while requiring exact ARN, queue and stack identity',async()=>{
 const {auditProductionRelease}=await load(),f=fixture(),r=auditProductionRelease(f);
 expect(r.passed).toBe(true);expect(r.resources.cleanupConsumer).toBe('AttachmentObjectEventsSubscriberXvxecaFunctionFunction-xztsmknd');
 expect(r.checks.cleanupFunctionBinding).toBe(true);expect(r.checks.cleanupStackIdentity).toBe(true);
 for(const edit of [
  (g:any)=>{g.mapping.FunctionArn=g.functionArn.replace(':123456789012:',':456789012345:');},
  (g:any)=>{g.mapping.FunctionArn=g.functionArn.replace('us-west-2','us-east-1');},
  (g:any)=>{g.mapping.EventSourceArn=g.arn+'foreign';},
  (g:any)=>{g.consumerEnv.SST_RESOURCE_App=JSON.stringify({name:'waka',stage:'development'});},
  (g:any)=>{g.consumerEnv.SST_RESOURCE_App=JSON.stringify({name:'other',stage:'production'});},
  (g:any)=>{g.consumerEnv.DB_CONNECTION_URL='foreign';},
  (g:any)=>{g.consumerEnv.ATTACHMENTS_BUCKET='foreign';},
  (g:any)=>{g.consumerEnv.ATTACHMENTS_REGION='us-east-1';},
  (g:any)=>{g.consumerEnv.GEMINI_API_KEY='UNNEEDED_PRIVATE_KEY';},
 ]){const g=fixture();edit(g);expect(auditProductionRelease(g).passed).toBe(false);}
});

it('checks every model runtime identity/profile and enables enrollment only in the API',async()=>{
 const {auditProductionRelease}=await load();
 for(const role of ['apiFunctionName','backgroundWorkerFunctionName','principleRefreshFunctionName'] as const)for(const patch of [
  {WAKA_GENERATION_PROVIDER:'openrouter'},{WAKA_MODEL_IMAGE:'foreign'},{WAKA_MODEL_SYNTHESIZE:'gpt-6.1-terra'},
  {WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2:role==='apiFunctionName'?'0':'1'},{SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'development'})},
 ]){const f=fixture(),read=f.read;expect(auditProductionRelease({...f,read:(args:string[])=>{const row=read(args);if(args[1]==='get-function-configuration'&&args.at(-1)===f.outputs[role])return {...row,Environment:{Variables:{...row.Environment!.Variables,...patch}}};return row;}}).passed).toBe(false);}
 const f=fixture(),read=f.read;expect(auditProductionRelease({...f,read:(args:string[])=>{const row=read(args);return args.at(-1)===f.outputs.principleRefreshFunctionName?{...row,FunctionArn:'arn:aws:lambda:us-west-2:999999999999:function:foreign'}:row;}}).passed).toBe(false);
});

it('keeps closed-mode human secrets absent in API/worker/principle/cleanup',async()=>{
 const {auditProductionRelease}=await load();const baseline=auditProductionRelease(fixture());expect(baseline.checks.signupAdmissionIsolated).toBe(true);expect(baseline.checks.cleanupNoSignupSecrets).toBe(true);
 for(const role of ['apiFunctionName','backgroundWorkerFunctionName','principleRefreshFunctionName'] as const)for(const patch of [{WAKA_TURNSTILE_SECRET:'SYNTHETIC_PRIVATE_HUMAN_KEY'},{WAKA_TURNSTILE_SITE_KEY:'synthetic-site'},{WAKA_SIGNUP_ADMISSION:'turnstile'}]){const f=fixture(),read=f.read;const report=auditProductionRelease({...f,read:(args:string[])=>{const row=read(args);return args.at(-1)===f.outputs[role]&&'Environment' in row?{...row,Environment:{Variables:{...row.Environment!.Variables,...patch}}}:row;}});expect(report.passed).toBe(false);expect(report.checks.signupAdmissionIsolated).toBe(false);expect(JSON.stringify(report)).not.toContain('SYNTHETIC_PRIVATE');}
 const f=fixture();Object.assign(f.consumerEnv,{WAKA_TURNSTILE_SECRET:'SYNTHETIC_PRIVATE_HUMAN_KEY'});const r=auditProductionRelease(f);expect(r.checks.cleanupNoSignupSecrets).toBe(false);expect(r.checks.cleanupIsolated).toBe(false);expect(r.passed).toBe(false);
});

// Actual stage configuration changes what the API must carry; other roles stay keyless.
it('requires exact production human-verification inputs and preserves worker/cleanup isolation',async()=>{
 const {auditProductionRelease}=await load();const accepted=auditProductionRelease(fixture('turnstile'));
 expect(accepted.passed).toBe(true);expect(Object.keys(accepted.checks)).toHaveLength(56);expect(accepted.checks.apiNewHumanEnrollmentEnabled).toBe(true);expect(accepted.checks).not.toHaveProperty('apiNewHumanEnrollmentOff');expect(JSON.stringify(accepted)).not.toContain('PRIVATE_HUMAN');
 for(const patch of [{WAKA_TURNSTILE_SECRET:undefined},{WAKA_TURNSTILE_SECRET:'wrong'},{WAKA_TURNSTILE_SITE_KEY:'foreign'},{WAKA_SIGNUP_ADMISSION:'closed'},{PUBLIC_WEB_URL:'https://dev.waka.im'}]){const f=fixture('turnstile'),read=f.read;const r=auditProductionRelease({...f,read:(args:string[])=>{const row=read(args);return args.at(-1)===f.outputs.apiFunctionName?{...row,Environment:{Variables:{...row.Environment!.Variables,...patch}}}:row;}});expect(r.checks.signupAdmissionIsolated).toBe(false);expect(r.passed).toBe(false);expect(JSON.stringify(r)).not.toContain('PRIVATE_HUMAN');}
 expect(auditProductionRelease(fixture('invalid')).passed).toBe(false);
 const dummy=fixture('turnstile');dummy.expected.turnstileSecret='1x0000000000000000000000000000000AA';expect(auditProductionRelease(dummy).checks.signupAdmissionIsolated).toBe(false);
 for(const role of ['backgroundWorkerFunctionName','principleRefreshFunctionName'] as const)for(const key of ['WAKA_TURNSTILE_SECRET','SST_RESOURCE_TurnstileSecret']){const f=fixture('turnstile'),read=f.read;const r=auditProductionRelease({...f,read:(args:string[])=>{const row=read(args);return args.at(-1)===f.outputs[role]?{...row,Environment:{Variables:{...row.Environment!.Variables,[key]:f.expected.turnstileSecret}}}:row;}});expect(r.passed).toBe(false);expect(r.checks.signupAdmissionIsolated).toBe(false);}
 const cleanup=fixture('turnstile');Object.assign(cleanup.consumerEnv,{WAKA_TURNSTILE_SECRET:cleanup.expected.turnstileSecret});expect(auditProductionRelease(cleanup).checks.cleanupNoSignupSecrets).toBe(false);
});

it('accepts explicit production off only on the canonical API with no challenge material', async () => {
 const {auditProductionRelease}=await load();
 const off=fixture('off');
 const accepted=auditProductionRelease(off);
 expect(accepted.passed).toBe(true);
 expect(Object.keys(accepted.checks).sort()).toEqual(Object.keys(auditProductionRelease(fixture()).checks).sort());
 expect(Object.keys(accepted.checks)).toHaveLength(56);
 for (const patch of [
  {PUBLIC_WEB_URL:'https://dev.waka.im'},{PUBLIC_WEB_URL:undefined},{WAKA_SIGNUP_ADMISSION:undefined},
  {WAKA_STAGE:'development'},{SST_RESOURCE_App:'{"name":"other","stage":"production"}'},
  {WAKA_TURNSTILE_SECRET:''},{WAKA_TURNSTILE_SITE_KEY:''},{SST_RESOURCE_TurnstileSecret:'SYNTHETIC_PRIVATE_BINDING'},
 ]) {
  const r=auditProductionRelease({...off,read:(args:string[])=>{
   const row=off.read(args);
   return args.at(-1)===off.outputs.apiFunctionName&&'Environment' in row
    ? {...row,Environment:{Variables:{...row.Environment!.Variables,...patch}}}
    : row;
  }});
  expect(r.checks.signupAdmissionIsolated).toBe(false);
  expect(r.passed).toBe(false);
  expect(JSON.stringify(r)).not.toContain('SYNTHETIC_PRIVATE');
 }
});
