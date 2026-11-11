import {expect,it} from 'vitest';
import {resolve} from 'node:path';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/production-release-audit.mjs'));
function fixture(){
 const expected={database:'PRIVATE_DB_DO_NOT_PRINT',openRouter:'PRIVATE_KEY_DO_NOT_PRINT',attachments:'bucket',vault:'vault'};
 const outputs={apiFunctionName:'waka-production-api',backgroundWorkerFunctionName:'waka-production-worker',attachmentsBucket:'bucket',vaultBucket:'vault'};
 const env={DB_CONNECTION_URL:expected.database,OPENROUTER_API_KEY:expected.openRouter,WAKA_CONVERSATION_REPLIES:'1',WAKA_MODEL_CHAT:'deepseek/deepseek-v4.1-flash-1017',WAKA_STAGE:'production',ATTACHMENTS_BUCKET:'bucket',WAKA_VAULT_BUCKET:'vault',WAKA_BACKGROUND_WORKER_FUNCTION:'waka-production-worker'};
 const read=(args:string[])=>{
  if(args[1]==='get-function-configuration')return args.includes('waka-production-consumer')?{Timeout:30,Environment:{Variables:{DB_CONNECTION_URL:expected.database,ATTACHMENTS_BUCKET:'bucket'}}}:{Environment:{Variables:env}};
  if(args[1]==='get-bucket-notification-configuration')return {QueueConfigurations:[{Events:['s3:ObjectCreated:*'],QueueArn:'arn:aws:sqs:us-west-2:123:waka-production-events'}]};
  if(args[1]==='get-queue-url')return {QueueUrl:args.includes('waka-production-dlq')?'dlq':'queue'};
  if(args[1]==='get-queue-attributes')return {Attributes:args.includes('dlq')?{MessageRetentionPeriod:'1209600'}:{VisibilityTimeout:'180',MessageRetentionPeriod:'1209600',RedrivePolicy:JSON.stringify({maxReceiveCount:5,deadLetterTargetArn:'arn:aws:sqs:us-west-2:123:waka-production-dlq'})}};
  if(args[1]==='list-event-source-mappings')return {EventSourceMappings:[{State:'Enabled',BatchSize:1,FunctionResponseTypes:['ReportBatchItemFailures'],FunctionArn:'arn:aws:lambda:us-west-2:123:function:waka-production-consumer'}]};
  throw Error('Unexpected read');
 };return {expected,outputs,env,read};
}
it('accepts stage-scoped runtime and durable event wiring without returning credential values',async()=>{
 const {auditProductionRelease}=await load(),f=fixture(),r=auditProductionRelease(f);
 expect(r.passed).toBe(true);expect(JSON.stringify(r)).not.toMatch(/PRIVATE_DB|PRIVATE_KEY/);
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
