/** Read-only deployment acceptance. Secrets never leave the in-memory reader. */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function auditProductionRelease({outputs,expected,read}){
 const checks={},resources={};
 const api=read(['lambda','get-function-configuration','--function-name',outputs.apiFunctionName]);
 const worker=read(['lambda','get-function-configuration','--function-name',outputs.backgroundWorkerFunctionName]);
 const a=api.Environment?.Variables??{},w=worker.Environment?.Variables??{};
 for(const [role,env] of [['api',a],['worker',w]]){
  checks[role+'DatabaseMatches']=!!expected.database&&env.DB_CONNECTION_URL===expected.database;
  checks[role+'OpenRouterMatches']=!!expected.openRouter&&env.OPENROUTER_API_KEY===expected.openRouter;
  checks[role+'ChatEnabled']=env.WAKA_CONVERSATION_REPLIES==='1';
  checks[role+'ChatModelMatches']=env.WAKA_MODEL_CHAT==='deepseek/deepseek-v4.1-flash-1017';
  checks[role+'StageProduction']=env.WAKA_STAGE==='production';
  checks[role+'AdminClosed']=!['WAKA_ENABLE_ADMIN_ROUTES','WAKA_SHOW_INTERNAL_STATUS','WAKA_ENABLE_BACKGROUND_JOBS_ADMIN'].some(k=>['1','true'].includes(env[k]));
  checks[role+'AttachmentsPreserved']=env.ATTACHMENTS_BUCKET===expected.attachments;
  checks[role+'VaultPreserved']=env.WAKA_VAULT_BUCKET===expected.vault;
 }
 checks.workerPointer=a.WAKA_BACKGROUND_WORKER_FUNCTION===outputs.backgroundWorkerFunctionName;
 checks.outputStoresPreserved=outputs.attachmentsBucket===expected.attachments&&outputs.vaultBucket===expected.vault;
 resources.api=outputs.apiFunctionName;resources.worker=outputs.backgroundWorkerFunctionName;
 const notifications=read(['s3api','get-bucket-notification-configuration','--bucket',expected.attachments]);
 const events=(notifications.QueueConfigurations??[]).filter(n=>n.Events?.includes('s3:ObjectCreated:*')&&/^arn:aws:sqs:us-west-2:\d+:waka-production-/.test(n.QueueArn));
 checks.completedPutNotification=events.length===1;
 if(events.length===1){
  const arn=events[0].QueueArn,name=arn.split(':').at(-1),account=arn.split(':')[4];
  const url=read(['sqs','get-queue-url','--queue-name',name,'--queue-owner-aws-account-id',account]).QueueUrl;
  const attrs=read(['sqs','get-queue-attributes','--queue-url',url,'--attribute-names','All']).Attributes??{};
  const redrive=JSON.parse(attrs.RedrivePolicy??'{}');
  checks.queueVisibility=attrs.VisibilityTimeout==='180';checks.queueRetention=attrs.MessageRetentionPeriod==='1209600';checks.redrive=String(redrive.maxReceiveCount)==='5'&&/^arn:aws:sqs:us-west-2:\d+:waka-production-/.test(redrive.deadLetterTargetArn??'');
  const mappings=read(['lambda','list-event-source-mappings','--event-source-arn',arn]).EventSourceMappings??[];
  checks.cleanupMapping=mappings.length===1&&mappings[0].State==='Enabled'&&mappings[0].BatchSize===1&&mappings[0].FunctionResponseTypes?.includes('ReportBatchItemFailures')===true;
  if(mappings.length===1){
   const fn=mappings[0].FunctionArn.split(':').at(-1),consumer=read(['lambda','get-function-configuration','--function-name',fn]);
   const env=consumer.Environment?.Variables??{};resources.cleanupConsumer=fn;
   checks.cleanupIsolated=fn.startsWith('waka-production-')&&consumer.Timeout===30&&env.DB_CONNECTION_URL===expected.database&&env.ATTACHMENTS_BUCKET===expected.attachments&&!env.OPENROUTER_API_KEY&&!env.GEMINI_API_KEY;
  }
  if(checks.redrive){
   const dlqName=redrive.deadLetterTargetArn.split(':').at(-1),dlqUrl=read(['sqs','get-queue-url','--queue-name',dlqName,'--queue-owner-aws-account-id',account]).QueueUrl;
   checks.dlqRetention=read(['sqs','get-queue-attributes','--queue-url',dlqUrl,'--attribute-names','MessageRetentionPeriod']).Attributes?.MessageRetentionPeriod==='1209600';
   resources.queue=name;resources.dlq=dlqName;
  }
 }
 return {stage:'production',observedAt:new Date().toISOString(),checks,resources,passed:Object.values(checks).every(v=>v===true),actualLatePutExercise:false,externalAlertDeliveryVerified:false,finiteErasureSlaEstablished:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const outputs=JSON.parse(readFileSync('.sst/outputs.json','utf8'));
  const report=auditProductionRelease({outputs,expected:{database:process.env.DB_CONNECTION_URL,openRouter:process.env.OPENROUTER_API_KEY,attachments:'waka-production-attachmentsbucket-rceuztkc',vault:'waka-production-vaultbucket-baskzfwm'},read:args=>JSON.parse(execFileSync('aws',[...args,'--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))});
  console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
 }catch{console.error('Production read-only acceptance unavailable; no secret diagnostics printed.');process.exitCode=1;}
}
