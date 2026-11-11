/** Read-only deployment acceptance. Secrets never leave the in-memory reader. */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const list=value=>Array.isArray(value)?value:[value];
const document=value=>typeof value==='string'?JSON.parse(decodeURIComponent(value)):value;
export function scopedS3SendPolicy(value,queueArn,bucket,account){
 const statements=list(document(value)?.Statement??[]),allow=statements.filter(s=>s.Effect==='Allow');
 return allow.length===1&&allow.every(s=>!s.NotAction&&!s.NotResource&&Object.keys(s.Principal??{}).join()==='Service'&&
  list(s.Principal.Service).join()==='s3.amazonaws.com'&&list(s.Action).join()==='sqs:SendMessage'&&list(s.Resource).join()===queueArn&&
  list(s.Condition?.ArnEquals?.['aws:SourceArn']).join()===`arn:aws:s3:::${bucket}`&&list(s.Condition?.StringEquals?.['aws:SourceAccount']).join()===account);
}
export function isolatedCleanupRole({roleArn,queueArn,bucket,read}){
 const roleName=roleArn.split('/').at(-1),role=read(['iam','get-role','--role-name',roleName]).Role;
 const trust=list(document(role?.AssumeRolePolicyDocument)?.Statement??[]).filter(s=>s.Effect==='Allow');
 if(role?.Arn!==roleArn||trust.length!==1||Object.keys(trust[0].Principal??{}).join()!=='Service'||list(trust[0].Principal.Service).join()!=='lambda.amazonaws.com'||list(trust[0].Action).join()!=='sts:AssumeRole')return false;
 const managed=read(['iam','list-attached-role-policies','--role-name',roleName]).AttachedPolicies??[];
 const approvedManaged=new Set(['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole','arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess']);
 if(managed.some(p=>!approvedManaged.has(p.PolicyArn)))return false;
 const names=read(['iam','list-role-policies','--role-name',roleName]).PolicyNames??[],allowedResources=new Set([queueArn,`arn:aws:s3:::${bucket}/*`]);
 const poll=new Set(['sqs:ChangeMessageVisibility','sqs:DeleteMessage','sqs:GetQueueAttributes','sqs:GetQueueUrl','sqs:ReceiveMessage']);
 let hasQueue=false,hasBucket=false;
 for(const name of names){
  const p=read(['iam','get-role-policy','--role-name',roleName,'--policy-name',name]);
  for(const s of list(document(p.PolicyDocument)?.Statement??[])){
   if(s.Effect!=='Allow')continue;if(s.NotAction||s.NotResource)return false;
   const actions=list(s.Action),resources=list(s.Resource);
   if(actions.every(a=>['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents','logs:DescribeLogStreams','xray:PutTraceSegments','xray:PutTelemetryRecords'].includes(a)))continue;
   if(!actions.length||!resources.length||resources.some(r=>!allowedResources.has(r))||actions.some(a=>!poll.has(a)&&a!=='s3:DeleteObject'))return false;
   if(actions.some(a=>poll.has(a))&&resources.includes(queueArn))hasQueue=true;
   if(actions.includes('s3:DeleteObject')&&resources.includes(`arn:aws:s3:::${bucket}/*`))hasBucket=true;
  }
 }
 return hasQueue&&hasBucket;
}
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
  checks.sendPolicyScoped=scopedS3SendPolicy(attrs.Policy,arn,expected.attachments,account);
  checks.queueVisibility=attrs.VisibilityTimeout==='180';checks.queueRetention=attrs.MessageRetentionPeriod==='1209600';checks.redrive=String(redrive.maxReceiveCount)==='5'&&/^arn:aws:sqs:us-west-2:\d+:waka-production-/.test(redrive.deadLetterTargetArn??'');
  const mappings=read(['lambda','list-event-source-mappings','--event-source-arn',arn]).EventSourceMappings??[];
  checks.cleanupMapping=mappings.length===1&&mappings[0].State==='Enabled'&&mappings[0].BatchSize===1&&mappings[0].FunctionResponseTypes?.includes('ReportBatchItemFailures')===true;
  if(mappings.length===1){
   const mapping=mappings[0],functionArn=mapping.FunctionArn,consumer=read(['lambda','get-function-configuration','--function-name',functionArn]);
   const env=consumer.Environment?.Variables??{};resources.cleanupConsumer=functionArn.split(':function:').at(-1);resources.cleanupFunctionArn=functionArn;
   checks.cleanupIamIsolated=isolatedCleanupRole({roleArn:consumer.Role,queueArn:arn,bucket:expected.attachments,read});
   resources.cleanupRole=consumer.Role?.split('/').at(-1);
   // Generated nested-function names need not contain the app/stage prefix.
   // Bind identity to the exact queue mapping, function ARN and SST stack,
   // then attest each runtime boundary separately for useful diagnostics.
   let app;try{app=JSON.parse(env.SST_RESOURCE_App??'{}');}catch{app={};}
   checks.cleanupFunctionBinding=mapping.EventSourceArn===arn&&consumer.FunctionArn===functionArn&&
    functionArn.startsWith(`arn:aws:lambda:us-west-2:${account}:function:`);
   checks.cleanupStackIdentity=app.name==='waka'&&app.stage==='production';
   checks.cleanupTimeout=consumer.Timeout===30;
   checks.cleanupDatabaseMatches=!!expected.database&&env.DB_CONNECTION_URL===expected.database;
   checks.cleanupBucketMatches=env.ATTACHMENTS_BUCKET===expected.attachments;
   checks.cleanupRegionMatches=env.ATTACHMENTS_REGION==='us-west-2';
   checks.cleanupNoModelKeys=!env.OPENROUTER_API_KEY&&!env.GEMINI_API_KEY;
   checks.cleanupIsolated=['cleanupFunctionBinding','cleanupStackIdentity','cleanupTimeout','cleanupDatabaseMatches','cleanupBucketMatches','cleanupRegionMatches','cleanupNoModelKeys'].every(key=>checks[key]===true);
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
