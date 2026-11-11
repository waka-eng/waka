import {expect,it} from 'vitest';
import {resolve} from 'node:path';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-release-audit.mjs'));
function fixture(){
 const expected={database:'PRIVATE_DB_DO_NOT_PRINT',openRouter:'PRIVATE_KEY_DO_NOT_PRINT',attachments:'bucket',vault:'vault'};
 const outputs={apiFunctionName:'waka-production-api',backgroundWorkerFunctionName:'waka-production-worker',attachmentsBucket:'bucket',vaultBucket:'vault'};
 const arn='arn:aws:sqs:us-west-2:123:waka-production-events',roleArn='arn:aws:iam::123:role/waka-production-consumer';
 const env={DB_CONNECTION_URL:expected.database,OPENROUTER_API_KEY:expected.openRouter,WAKA_CONVERSATION_REPLIES:'1',WAKA_MODEL_CHAT:'deepseek/deepseek-v4.1-flash-1017',WAKA_STAGE:'production',ATTACHMENTS_BUCKET:'bucket',WAKA_VAULT_BUCKET:'vault',WAKA_BACKGROUND_WORKER_FUNCTION:'waka-production-worker'};
 const policy={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'s3.amazonaws.com'},Action:'sqs:SendMessage',Resource:arn,Condition:{ArnEquals:{'aws:SourceArn':'arn:aws:s3:::bucket'},StringEquals:{'aws:SourceAccount':'123'}}}]};
 const iam={Statement:[{Effect:'Allow',Action:['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes','sqs:GetQueueUrl','sqs:ChangeMessageVisibility'],Resource:arn},{Effect:'Allow',Action:'s3:DeleteObject',Resource:'arn:aws:s3:::bucket/*'},{Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:'*'}]};
 const trust={Statement:[{Effect:'Allow',Action:'sts:AssumeRole',Principal:{Service:'lambda.amazonaws.com'}}]};
 const managed=[{PolicyArn:'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'}];
 const read=(args:string[])=>{
  if(args[1]==='get-function-configuration')return args.includes('waka-production-consumer')?{Role:roleArn,Timeout:30,Environment:{Variables:{DB_CONNECTION_URL:expected.database,ATTACHMENTS_BUCKET:'bucket'}}}:{Environment:{Variables:env}};
  if(args[1]==='get-bucket-notification-configuration')return {QueueConfigurations:[{Events:['s3:ObjectCreated:*'],QueueArn:arn}]};
  if(args[1]==='get-queue-url')return {QueueUrl:args.includes('waka-production-dlq')?'dlq':'queue'};
  if(args[1]==='get-queue-attributes')return {Attributes:args.includes('dlq')?{MessageRetentionPeriod:'1209600'}:{Policy:JSON.stringify(policy),VisibilityTimeout:'180',MessageRetentionPeriod:'1209600',RedrivePolicy:JSON.stringify({maxReceiveCount:5,deadLetterTargetArn:'arn:aws:sqs:us-west-2:123:waka-production-dlq'})}};
  if(args[1]==='list-event-source-mappings')return {EventSourceMappings:[{State:'Enabled',BatchSize:1,FunctionResponseTypes:['ReportBatchItemFailures'],FunctionArn:'arn:aws:lambda:us-west-2:123:function:waka-production-consumer'}]};
  if(args[1]==='get-role')return {Role:{Arn:roleArn,AssumeRolePolicyDocument:trust}};
  if(args[1]==='list-attached-role-policies')return {AttachedPolicies:managed};
  if(args[1]==='list-role-policies')return {PolicyNames:['ScopedConsumer']};
  if(args[1]==='get-role-policy')return {PolicyDocument:iam};
  throw Error('Unexpected read');
 };return {expected,outputs,env,read,policy,iam,managed,trust,arn,roleArn};
}
it('accepts stage-scoped runtime and durable event wiring without returning credential values',async()=>{
 const {auditProductionRelease}=await load(),f=fixture(),r=auditProductionRelease(f);
 expect(r.passed).toBe(true);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_DB|PRIVATE_KEY/);
 expect(r.checks.sendPolicyScoped).toBe(true);expect(r.checks.cleanupIamIsolated).toBe(true);
 expect(r.actualLatePutExercise).toBe(false);expect(r.externalAlertDeliveryVerified).toBe(false);
});
it('fails mismatched provider/DB, leaked admin flags, missing notifications and event mapping readiness',async()=>{
 const {auditProductionRelease}=await load();
 for(const patch of [{DB_CONNECTION_URL:'wrong'},{OPENROUTER_API_KEY:'wrong'},{WAKA_CONVERSATION_REPLIES:'0'},{WAKA_ENABLE_ADMIN_ROUTES:'true'},{WAKA_MODEL_CHAT:'unapproved'}]){
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
 expect(scopedS3SendPolicy(f.policy,f.arn,'bucket','123')).toBe(false);
});
it('refuses unneeded bucket CRUD/read, foreign queues, wildcard model permissions and unexpected managed/trust policies',async()=>{
 const {auditProductionRelease}=await load();
 for(const edit of [
  (f:any)=>{f.iam.Statement[1].Action='s3:*';},
  (f:any)=>{f.iam.Statement[1].Action='s3:GetObject';},
  (f:any)=>{f.iam.Statement[1].Resource='arn:aws:s3:::other/*';},
  (f:any)=>{f.iam.Statement[0].Resource='arn:aws:sqs:us-west-2:123:other';},
  (f:any)=>{f.iam.Statement.push({Effect:'Allow',Action:'bedrock:InvokeModel',Resource:'*'});},
  (f:any)=>{f.managed.push({PolicyArn:'arn:aws:iam::aws:policy/AdministratorAccess'});},
  (f:any)=>{f.trust.Statement[0].Principal={AWS:'*'};},
 ]){const f=fixture();edit(f);expect(auditProductionRelease(f).passed).toBe(false);}
});
