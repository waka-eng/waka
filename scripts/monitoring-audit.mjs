/** Read-only production monitoring acceptance; never sends a notification. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {alarmLabels} from '../packages/api/src/monitoring/protocol.ts';
const list = v => Array.isArray(v) ? v : [v];
const doc = v => typeof v === 'string' ? JSON.parse(decodeURIComponent(v)) : v;
const logs = new Set(['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents','logs:DescribeLogStreams','xray:PutTraceSegments','xray:PutTelemetryRecords']);
const standardManaged = new Set(['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole','arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess']);
export function isolatedMonitorRole(roleArn, allowed, read, leadingKeys) {
  const seen=new Set();
  const roleName=roleArn.split('/').at(-1),role=read(['iam','get-role','--role-name',roleName]).Role;
  const trust=list(doc(role?.AssumeRolePolicyDocument)?.Statement??[]).filter(s=>s.Effect==='Allow');
  if(role?.Arn!==roleArn||trust.length!==1||Object.keys(trust[0].Principal??{}).join()!=='Service'||list(trust[0].Principal.Service).join()!=='lambda.amazonaws.com'||list(trust[0].Action).join()!=='sts:AssumeRole')return false;
  if((read(['iam','list-attached-role-policies','--role-name',roleName]).AttachedPolicies??[]).some(p=>!standardManaged.has(p.PolicyArn)))return false;
  for(const name of read(['iam','list-role-policies','--role-name',roleName]).PolicyNames??[]){
    for(const s of list(doc(read(['iam','get-role-policy','--role-name',roleName,'--policy-name',name]).PolicyDocument)?.Statement??[])){
      if(s.Effect!=='Allow')continue;
      if(s.NotAction||s.NotResource||!s.Action||!s.Resource)return false;
      const actions=list(s.Action),resources=list(s.Resource);
      if(actions.every(a=>logs.has(a)))continue;
      if(actions.some(a=>!allowed[a]||resources.some(r=>!allowed[a].includes(r))))return false;
      if(actions.some(a=>a.startsWith('dynamodb:'))&&(!leadingKeys||String(s.Condition?.Null?.['dynamodb:LeadingKeys'])!=='false'||list(s.Condition?.[leadingKeys.operator]?.['dynamodb:LeadingKeys']??[]).slice().sort().join()!==leadingKeys.values.slice().sort().join()))return false;
      for(const a of actions)seen.add(a);
    }
  }
  return Object.keys(allowed).every(a=>seen.has(a));
}
export function auditMonitoring({outputs,webhook,read}) {
  const account=read(['sts','get-caller-identity']).Account,region='us-west-2',checks={};
  const fn=name=>read(['lambda','get-function-configuration','--function-name',name]);
  const relay=fn(outputs.monitorRelayFunctionName),probe=fn(outputs.monitorProbeFunctionName),api=fn(outputs.apiFunctionName);
  checks.apiHealthCostBounds=Number.isFinite(api.Timeout)&&api.Timeout<=60&&Number.isFinite(api.MemorySize)&&api.MemorySize<=1024;
  const env=relay.Environment?.Variables??{},probeEnv=probe.Environment?.Variables??{};
  const app=e=>{try{return JSON.parse(e.SST_RESOURCE_App??'{}');}catch{return {};}};
  checks.relayIdentity=relay.FunctionName===outputs.monitorRelayFunctionName&&relay.FunctionArn===`arn:aws:lambda:${region}:${account}:function:${relay.FunctionName}`&&app(env).name==='waka'&&app(env).stage==='production';
  checks.probeIdentity=probe.FunctionName===outputs.monitorProbeFunctionName&&probe.FunctionArn===`arn:aws:lambda:${region}:${account}:function:${probe.FunctionName}`&&app(probeEnv).name==='waka'&&app(probeEnv).stage==='production';
  const relayKeys=new Set(['WAKA_STAGE','MONITOR_ACCOUNT','MONITOR_TABLE','WAKA_DISCORD_WEBHOOK_URL','SST_RESOURCE_App','SST_RESOURCE_DiscordWebhookUrl','NODE_OPTIONS']);
  checks.relayEnvironment=Object.keys(env).every(k=>relayKeys.has(k))&&env.WAKA_STAGE==='production'&&env.MONITOR_ACCOUNT===account&&env.MONITOR_TABLE===outputs.monitorDeliveryTable&&!!webhook&&env.WAKA_DISCORD_WEBHOOK_URL===webhook;
  checks.probeEnvironment=Object.keys(probeEnv).every(k=>['SST_RESOURCE_App','NODE_OPTIONS','MONITOR_TABLE'].includes(k))&&probeEnv.MONITOR_TABLE===outputs.monitorDeliveryTable;
  checks.boundedFunctions=relay.Timeout===20&&relay.MemorySize===128&&probe.Timeout===12&&probe.MemorySize===128;
  checks.relayConcurrency=read(['lambda','get-function-concurrency','--function-name',relay.FunctionName]).ReservedConcurrentExecutions===1;
  const table=read(['dynamodb','describe-table','--table-name',outputs.monitorDeliveryTable]).Table;
  checks.intentTable=table?.TableStatus==='ACTIVE'&&table.TableArn===`arn:aws:dynamodb:${region}:${account}:table/${outputs.monitorDeliveryTable}`&&table?.BillingModeSummary?.BillingMode==='PAY_PER_REQUEST'&&table?.KeySchema?.length===1&&table.KeySchema[0].AttributeName==='id'&&table.KeySchema[0].KeyType==='HASH';
  const ttl=read(['dynamodb','describe-time-to-live','--table-name',outputs.monitorDeliveryTable]).TimeToLiveDescription;
  checks.intentRetention=ttl?.AttributeName==='expires'&&['ENABLED','ENABLING'].includes(ttl.TimeToLiveStatus);
  const queue=read(['sqs','get-queue-attributes','--queue-url',outputs.monitorDeliveryDlqUrl,'--attribute-names','All']).Attributes??{};
  checks.failureRetention=queue.MessageRetentionPeriod==='1209600'&&!queue.RedrivePolicy;
  checks.failureQueueIsolated=queue.QueueArn?.startsWith(`arn:aws:sqs:${region}:${account}:`)&&outputs.monitorDeliveryDlqUrl.startsWith(`https://sqs.${region}.amazonaws.com/${account}/`)&&queue.SqsManagedSseEnabled==='true'&&!list(doc(queue.Policy??'{}').Statement??[]).some(s=>s.Effect==='Allow');
  const invoke=read(['lambda','get-function-event-invoke-config','--function-name',relay.FunctionName]);
  checks.boundedAsyncRetry=invoke.MaximumRetryAttempts===2&&invoke.MaximumEventAgeInSeconds===3600&&invoke.DestinationConfig?.OnFailure?.Destination===queue.QueueArn;
  const allow=Object.fromEntries(['dynamodb:PutItem','dynamodb:GetItem','dynamodb:UpdateItem'].map(a=>[a,[table.TableArn]]));allow['sqs:SendMessage']=[queue.QueueArn];
  checks.relayRole=isolatedMonitorRole(relay.Role,allow,read,{operator:'ForAllValues:StringLike',values:['event:*','head:waka-production-*']});
  checks.probeRole=isolatedMonitorRole(probe.Role,{'dynamodb:GetItem':[table.TableArn],'dynamodb:UpdateItem':[table.TableArn]},read,{operator:'ForAllValues:StringEquals',values:['probe:availability']});
  const names=Object.keys(alarmLabels).map(c=>`waka-production-${c}`);
  const alarms=read(['cloudwatch','describe-alarms','--alarm-names',...names]).MetricAlarms??[];
  checks.alarmActions=alarms.length===names.length&&alarms.every(a=>names.includes(a.AlarmName)&&a.ActionsEnabled===true&&list(a.AlarmActions??[]).join()===relay.FunctionArn&&list(a.OKActions??[]).join()===relay.FunctionArn&&!(a.InsufficientDataActions?.length));
  const byCode=Object.fromEntries(alarms.map(a=>[a.AlarmName.replace('waka-production-',''),a]));
  const simple=(code,namespace,metric,dimension,value)=>{const a=byCode[code];return a?.Namespace===namespace&&a.MetricName===metric&&a.Dimensions?.length===1&&a.Dimensions[0].Name===dimension&&a.Dimensions[0].Value===value;};
  checks.alarmMetrics=simple('Availability','AWS/Lambda','Errors','FunctionName',probe.FunctionName)&&simple('ProbeMissing','AWS/Lambda','Invocations','FunctionName',probe.FunctionName)&&
    simple('ApplicationFault','WAKA/Operations','Faults','Stage','production')&&
    simple('DeliveryDlq','AWS/SQS','ApproximateNumberOfMessagesVisible','QueueName',queue.QueueArn?.split(':').at(-1))&&simple('AttachmentDlq','AWS/SQS','ApproximateNumberOfMessagesVisible','QueueName',outputs.monitorAttachmentDlqName);
  const functions=[outputs.apiFunctionName,outputs.backgroundWorkerFunctionName,outputs.monitorPrincipleFunctionName,outputs.monitorCleanupFunctionName];
  checks.nativeFailureMetrics=['LambdaErrors','LambdaThrottles'].every(code=>{
    const metrics=byCode[code]?.Metrics??[],expected=functions;
    const raw=metrics.filter(m=>m.MetricStat);return metrics.length===expected.length+1&&raw.length===expected.length&&expected.every(name=>raw.some(m=>m.ReturnData===false&&m.MetricStat.Period===300&&m.MetricStat.Stat==='Sum'&&m.MetricStat.Metric.Namespace==='AWS/Lambda'&&m.MetricStat.Metric.MetricName===(code==='LambdaErrors'?'Errors':'Throttles')&&m.MetricStat.Metric.Dimensions?.length===1&&m.MetricStat.Metric.Dimensions[0].Name==='FunctionName'&&m.MetricStat.Metric.Dimensions[0].Value===name))&&metrics.some(m=>m.ReturnData===true&&m.Expression==='SUM(METRICS())');
  });
  checks.noDeliveryFeedback=['LambdaErrors','LambdaThrottles'].every(code=>!byCode[code]?.Metrics?.some(m=>m.MetricStat?.Metric?.Dimensions?.some(d=>d.Value===relay.FunctionName)));
  const workerEnv=fn(outputs.backgroundWorkerFunctionName).Environment?.Variables??{};
  checks.preciseWorkerWakes=!!outputs.monitorWakeGroup&&workerEnv.WAKA_BACKGROUND_JOB_WAKE_GROUP===outputs.monitorWakeGroup&&!!outputs.monitorWakeRole&&workerEnv.WAKA_BACKGROUND_JOB_WAKE_ROLE===outputs.monitorWakeRole&&outputs.monitorWakeRole.startsWith(`arn:aws:iam::${account}:role/`);
  const schedules=byCode.ScheduleDelivery?.Metrics??[];
  checks.scheduleFailures=schedules.length===3&&[outputs.monitorDailyRuleName,outputs.monitorPrincipleRuleName].every(name=>schedules.some(m=>m.ReturnData===false&&m.MetricStat?.Metric.Namespace==='AWS/Events'&&m.MetricStat.Metric.MetricName==='FailedInvocations'&&m.MetricStat.Metric.Dimensions?.length===1&&m.MetricStat.Metric.Dimensions[0].Name==='RuleName'&&m.MetricStat.Metric.Dimensions[0].Value===name));
  checks.probeAlarmsBounded=byCode.ProbeMissing?.EvaluationPeriods===3&&byCode.ProbeMissing?.Period===300&&byCode.ProbeMissing?.Threshold===1&&byCode.ProbeMissing?.ComparisonOperator==='LessThanThreshold'&&byCode.ProbeMissing?.TreatMissingData==='breaching'&&byCode.Availability?.EvaluationPeriods===2&&byCode.Availability?.Period===300&&byCode.Availability?.TreatMissingData==='notBreaching';
  const statements=list(doc(read(['lambda','get-policy','--function-name',relay.FunctionName]).Policy)?.Statement??[]).filter(s=>s.Effect==='Allow');
  checks.alarmInvocationPolicy=statements.length===names.length&&names.every(n=>statements.some(s=>list(s.Action).join()==='lambda:InvokeFunction'&&list(s.Resource).join()===relay.FunctionArn&&Object.keys(s.Principal??{}).join()==='Service'&&s.Principal.Service==='lambda.alarms.cloudwatch.amazonaws.com'&&s.Condition?.StringEquals?.['AWS:SourceAccount']===account&&(s.Condition?.ArnLike?.['AWS:SourceArn']??s.Condition?.ArnEquals?.['AWS:SourceArn'])===`arn:aws:cloudwatch:${region}:${account}:alarm:${n}`));
  checks.noRelaySecretInApp=[outputs.apiFunctionName,outputs.backgroundWorkerFunctionName,outputs.monitorPrincipleFunctionName,outputs.monitorCleanupFunctionName].every(name=>!Object.entries(fn(name).Environment?.Variables??{}).some(([key,value])=>key.includes('Discord')||key==='WAKA_DISCORD_WEBHOOK_URL'||(webhook&&value.includes(webhook))));
  checks.logRetention=[relay,probe].every(f=>read(['logs','describe-log-groups','--log-group-name-prefix',`/aws/lambda/${f.FunctionName}`]).logGroups?.some(g=>g.logGroupName===`/aws/lambda/${f.FunctionName}`&&g.retentionInDays===14));
  const rule=read(['events','describe-rule','--name',outputs.monitorProbeRuleName]);
  checks.probeSchedule=rule.State==='ENABLED'&&rule.ScheduleExpression==='rate(5 minutes)'&&(read(['events','list-targets-by-rule','--rule',outputs.monitorProbeRuleName]).Targets??[]).some(t=>t.Arn===probe.FunctionArn);
  const probeStatements=list(doc(read(['lambda','get-policy','--function-name',probe.FunctionName]).Policy)?.Statement??[]).filter(s=>s.Effect==='Allow');
  checks.probeInvocationPolicy=probeStatements.length===1&&probeStatements[0].Principal?.Service==='events.amazonaws.com'&&list(probeStatements[0].Action).join()==='lambda:InvokeFunction'&&(probeStatements[0].Condition?.ArnLike?.['AWS:SourceArn']??probeStatements[0].Condition?.ArnEquals?.['AWS:SourceArn'])===`arn:aws:events:${region}:${account}:rule/${outputs.monitorProbeRuleName}`;
  return {stage:'production',apiHealthRuntime:{memoryMb:api.MemorySize,timeoutSeconds:api.Timeout},observedAt:new Date().toISOString(),checks,passed:Object.values(checks).every(v=>v===true),notificationSent:false,alarmPathDeliveryVerified:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const report=auditMonitoring({outputs:JSON.parse(readFileSync('.sst/outputs.json','utf8')),webhook:process.env.WAKA_DISCORD_WEBHOOK_URL,read:args=>JSON.parse(execFileSync('aws',[...args,'--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))});
    console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
  }catch{console.error('Production monitoring acceptance unavailable; private diagnostics withheld.');process.exitCode=1;}
}
