import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {executeAuditCli} from './helpers/audit-cli';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/monitoring-audit.mjs'));
function fixture(){
  const account='111122223333',prefix=`arn:aws:lambda:us-west-2:${account}:function:`,webhook='PRIVATE_WEBHOOK_NEVER_PUBLISH';
  const outputs={apiFunctionName:'api',backgroundWorkerFunctionName:'worker',monitorPrincipleFunctionName:'principle',monitorCleanupFunctionName:'cleanup',monitorRelayFunctionName:'NestedRelay-generated',monitorProbeFunctionName:'probe',monitorDeliveryTable:'delivery',monitorDeliveryDlqUrl:'https://sqs.us-west-2.amazonaws.com/111122223333/delivery-dlq',monitorAttachmentDlqName:'attachment-dlq',monitorProbeRuleName:'probe-rule',monitorDailyRuleName:'daily-rule',monitorPrincipleRuleName:'principle-rule',monitorWakeGroup:'wake-group',monitorWakeRole:`arn:aws:iam::${account}:role/wakes`};
  const app=JSON.stringify({name:'waka',stage:'production'}),tableArn=`arn:aws:dynamodb:us-west-2:${account}:table/delivery`,queueArn=`arn:aws:sqs:us-west-2:${account}:delivery-dlq`;
  const relay={FunctionName:outputs.monitorRelayFunctionName,FunctionArn:prefix+outputs.monitorRelayFunctionName,Role:`arn:aws:iam::${account}:role/relay`,Timeout:20,MemorySize:128,Environment:{Variables:{SST_RESOURCE_App:app,WAKA_STAGE:'production',MONITOR_ACCOUNT:account,MONITOR_TABLE:'delivery',MONITOR_SEND_GATE:'alarm-head-v1',WAKA_DISCORD_WEBHOOK_URL:webhook}}};
  const probe={FunctionName:'probe',FunctionArn:prefix+'probe',Role:`arn:aws:iam::${account}:role/probe`,Timeout:12,MemorySize:128,Environment:{Variables:{SST_RESOURCE_App:app,MONITOR_TABLE:'delivery'}}};
  const trust={Statement:[{Effect:'Allow',Action:'sts:AssumeRole',Principal:{Service:'lambda.amazonaws.com'}}]};
  const policy={Statement:[{Effect:'Allow',Action:['dynamodb:PutItem','dynamodb:GetItem','dynamodb:UpdateItem'],Resource:tableArn,Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['event:*','head:waka-production-*']},Null:{'dynamodb:LeadingKeys':'false'}}},{Effect:'Allow',Action:'sqs:SendMessage',Resource:queueArn}]};
  const probePolicy={Statement:[{Effect:'Allow',Action:['dynamodb:GetItem','dynamodb:UpdateItem'],Resource:tableArn,Condition:{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['probe:availability']},Null:{'dynamodb:LeadingKeys':'false'}}}]};
  const spec=[['Availability','AWS/Lambda','Errors','FunctionName','probe'],['ApplicationFault','WAKA/Operations','Faults','Stage','production'],['ProbeMissing','AWS/Lambda','Invocations','FunctionName','probe'],['DeliveryDlq','AWS/SQS','ApproximateNumberOfMessagesVisible','QueueName','delivery-dlq'],['AttachmentDlq','AWS/SQS','ApproximateNumberOfMessagesVisible','QueueName','attachment-dlq'],];
  const alarms:any[]=spec.map(([code,Namespace,MetricName,Name,Value])=>({AlarmName:`waka-production-${code}`,Namespace,MetricName,Dimensions:[{Name,Value}]}));
  for(const [code,names,metric] of [['LambdaErrors',['api','worker','principle','cleanup'],'Errors'],['LambdaThrottles',['api','principle','cleanup','worker'],'Throttles'],['ScheduleDelivery',['daily-rule','principle-rule'],'FailedInvocations']] as const){alarms.push({AlarmName:`waka-production-${code}`,Metrics:[...names.map((Value,i)=>({Id:`m${i}`,ReturnData:false,MetricStat:{Period:300,Stat:'Sum',Metric:{Namespace:code==='ScheduleDelivery'?'AWS/Events':'AWS/Lambda',MetricName:metric,Dimensions:[{Name:code==='ScheduleDelivery'?'RuleName':'FunctionName',Value}]}}})),{Id:'total',Expression:'SUM(METRICS())',ReturnData:true}]});}
  for(const a of alarms)Object.assign(a,{ActionsEnabled:true,AlarmActions:[relay.FunctionArn],OKActions:[relay.FunctionArn],InsufficientDataActions:[]});
  Object.assign(alarms.find(a=>a.AlarmName.endsWith('-Availability')),{EvaluationPeriods:2,Period:300,TreatMissingData:'notBreaching'});
  Object.assign(alarms.find(a=>a.AlarmName.endsWith('-ProbeMissing')),{EvaluationPeriods:3,Period:300,Threshold:1,ComparisonOperator:'LessThanThreshold',TreatMissingData:'breaching'});
  const invocation={Statement:alarms.map(a=>({Effect:'Allow',Action:'lambda:InvokeFunction',Resource:relay.FunctionArn,Principal:{Service:'lambda.alarms.cloudwatch.amazonaws.com'},Condition:{StringEquals:{'AWS:SourceAccount':account},ArnLike:{'AWS:SourceArn':`arn:aws:cloudwatch:us-west-2:${account}:alarm:${a.AlarmName}`}}}))};
  const read=(args:string[])=>{
    if(args[1]==='get-caller-identity')return {Account:account};
    if(args[1]==='get-function-configuration')return args.at(-1)===relay.FunctionName?relay:args.at(-1)==='probe'?probe:{Timeout:60,MemorySize:1024,Environment:{Variables:{SST_RESOURCE_App:app,...(args.at(-1)==='worker'?{WAKA_BACKGROUND_JOB_WAKE_GROUP:'wake-group',WAKA_BACKGROUND_JOB_WAKE_ROLE:outputs.monitorWakeRole}:{})}}};
    if(args[1]==='get-function-concurrency')return {};
    if(args[1]==='describe-table')return {Table:{TableStatus:'ACTIVE',TableArn:tableArn,BillingModeSummary:{BillingMode:'PAY_PER_REQUEST'},KeySchema:[{AttributeName:'id',KeyType:'HASH'}]}};
    if(args[1]==='describe-time-to-live')return {TimeToLiveDescription:{AttributeName:'expires',TimeToLiveStatus:'ENABLED'}};
    if(args[1]==='get-queue-attributes')return {Attributes:{QueueArn:queueArn,MessageRetentionPeriod:'1209600',SqsManagedSseEnabled:'true'}};
    if(args[1]==='get-function-event-invoke-config')return {MaximumRetryAttempts:2,MaximumEventAgeInSeconds:3600,DestinationConfig:{OnFailure:{Destination:queueArn}}};
    if(args[1]==='get-role')return {Role:{Arn:args.at(-1)==='relay'?relay.Role:probe.Role,AssumeRolePolicyDocument:trust}};
    if(args[1]==='list-attached-role-policies')return {AttachedPolicies:[{PolicyArn:'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'}]};
    if(args[1]==='list-role-policies')return {PolicyNames:args.at(-1)==='relay'?['delivery']:['probe']};
    if(args[1]==='get-role-policy')return {PolicyDocument:args.includes('relay')?policy:probePolicy};
    if(args[1]==='describe-alarms')return {MetricAlarms:alarms};
    if(args[1]==='get-policy')return {Policy:JSON.stringify(args.at(-1)==='probe'?{Statement:[{Effect:'Allow',Action:'lambda:InvokeFunction',Principal:{Service:'events.amazonaws.com'},Condition:{ArnLike:{'AWS:SourceArn':`arn:aws:events:us-west-2:${account}:rule/probe-rule`}}}]}:invocation)};
    if(args[1]==='describe-log-groups')return {logGroups:[{logGroupName:args.at(-1),retentionInDays:14}]};
    if(args[1]==='describe-rule')return {State:'ENABLED',ScheduleExpression:'rate(5 minutes)'};
    if(args[1]==='list-targets-by-rule')return {Targets:[{Arn:probe.FunctionArn}]};
    throw Error('Unexpected metadata read');
  };
  return {outputs,webhook,read,relay,probe,policy,probePolicy,trust,alarms,invocation};
}
it('accepts generated names via exact live identity, scopes and wiring, without secrets in receipt',async()=>{const {auditMonitoring}=await load(),f=fixture(),r=auditMonitoring(f);expect(r.passed).toBe(true);expect(JSON.stringify(r)).not.toContain('PRIVATE_');expect(r.notificationSent).toBe(false);});
it.each(['foreignAccount','extraDatabase','extraModel','foreignAlarm','broadIam','missingIam','wrongMetric','foreignTrust','probeSecret','unboundedRetry','probeBroadKey','relayProbeKey','feedbackLoop','missingPreciseWakes'])('refuses %s',async kind=>{
  const {auditMonitoring}=await load(),f=fixture();
  if(kind==='foreignAccount')f.relay.FunctionArn=f.relay.FunctionArn.replace('111122223333','999988887777');
  if(kind==='extraDatabase')Object.assign(f.relay.Environment.Variables,{DB_CONNECTION_URL:'PRIVATE_DB'});
  if(kind==='extraModel')Object.assign(f.relay.Environment.Variables,{OPENROUTER_API_KEY:'PRIVATE_KEY'});
  if(kind==='foreignAlarm')f.invocation.Statement[0].Condition.ArnLike['AWS:SourceArn']='arn:aws:cloudwatch:us-west-2:999988887777:alarm:waka-production-Availability';
  if(kind==='broadIam')f.policy.Statement[0].Resource='*';
  if(kind==='missingIam')f.policy.Statement.splice(0);
  if(kind==='wrongMetric')f.alarms[0].Dimensions[0].Value='dev-probe';
  if(kind==='foreignTrust')f.trust.Statement[0].Principal={AWS:'*'} as any;
  if(kind==='probeSecret')Object.assign(f.probe.Environment.Variables,{WAKA_DISCORD_WEBHOOK_URL:'PRIVATE_WEBHOOK'});
  if(kind==='feedbackLoop')f.alarms.find(a=>a.AlarmName==='waka-production-LambdaErrors').Metrics[0].MetricStat.Metric.Dimensions[0].Value=f.outputs.monitorRelayFunctionName;
  if(kind==='probeBroadKey')f.probePolicy.Statement[0].Condition['ForAllValues:StringEquals']['dynamodb:LeadingKeys']=['*'];
  if(kind==='relayProbeKey')f.policy.Statement[0].Condition!['ForAllValues:StringLike']['dynamodb:LeadingKeys']=['*'];
  const read=(args:string[])=>{if(kind==='unboundedRetry'&&args[1]==='get-function-event-invoke-config')return {MaximumRetryAttempts:99};if(kind==='missingPreciseWakes'&&args[1]==='get-function-configuration'&&args.at(-1)==='worker')return {Environment:{Variables:{}}};return f.read(args);};
  expect(auditMonitoring({...f,read}).passed).toBe(false);
});
it('keeps monitoring production-only and secret outside the shared application links',()=>{
  const source=readFileSync(resolve(__dirname,'../../../sst.config.ts'),'utf8');
  const block=source.slice(source.indexOf('    // Production-only monitoring.'),source.indexOf('    // Frontend (Vite + React)'));
  expect(block).toContain('if ($app.stage === "production")');expect(block).not.toContain('link: runtimeLinks');expect(block).not.toContain('...runtimeEnvironment');
  expect(block).toContain('principal: "lambda.alarms.cloudwatch.amazonaws.com", sourceAccount: caller.accountId');
  expect(block).toContain('`arn:aws:cloudwatch:${AWS_REGION}:${account}:alarm:${alarmName}`');
  expect(block).toContain('{ dependsOn: [relay.nodes.function, permission] }');
  expect(block).toContain('link: [discord]');expect(block).not.toContain('reservedConcurrentExecutions');expect(block).toContain('MONITOR_SEND_GATE: "alarm-head-v1"');
  const workflow=readFileSync(resolve(__dirname,'../../../.github/workflows/deploy.yml'),'utf8');
  const job=workflow.slice(workflow.indexOf('  deploy:'));
  expect(job.slice(0,job.indexOf('    steps:'))).not.toContain('WAKA_DISCORD_WEBHOOK_URL');
  const install=job.slice(job.indexOf('      - name: Install dependencies'),job.indexOf('      - name: Validate deployment environment'));
  expect(install).not.toContain('WAKA_DISCORD_WEBHOOK_URL');
  expect(workflow).toContain('SST_SECRET_DiscordWebhookUrl: ${{ secrets.WAKA_DISCORD_WEBHOOK_URL }}');
});

it.each([0,1,7,null,undefined])('refuses any actual reservation field, including %s',async value=>{
  const {auditMonitoring}=await load(),f=fixture();
  const r=auditMonitoring({...f,read:(args:string[])=>args[1]==='get-function-concurrency'?{ReservedConcurrentExecutions:value}:f.read(args)});
  expect(r.checks.relayConcurrency).toBe(false);expect(r.passed).toBe(false);
});
it.each([undefined,'wrong-mode'])('refuses missing/wrong mandatory send-gate marker %s',async value=>{
  const {auditMonitoring}=await load(),f=fixture();
  if(value===undefined)delete (f.relay.Environment.Variables as any).MONITOR_SEND_GATE;else f.relay.Environment.Variables.MONITOR_SEND_GATE=value;
  const r=auditMonitoring(f);expect(r.checks.relaySendGate).toBe(false);expect(r.passed).toBe(false);
});
it.each([19,21,30])('refuses relay timeout %s despite a correct marker',async timeout=>{
  const {auditMonitoring}=await load(),f=fixture();f.relay.Timeout=timeout;const r=auditMonitoring(f);
  expect(r.checks.relaySendGate).toBe(false);expect(r.passed).toBe(false);
});

it('passes the full real audit through CLI serialization that omits stdout for {}',async()=>{
  const {auditMonitoring}=await load(),{readAuditAwsJson}=await import(/* @vite-ignore */resolve(__dirname,'../../../scripts/audit-diagnostics.mjs')),f=fixture();
  const execute=(_program:string,argv:string[])=>{
    const response=f.read(argv.slice(0,-4));
    // Executed official AWS CLI JSONFormatter proof: {} produces zero bytes.
    return Object.keys(response).length===0?'':JSON.stringify(response);
  };
  const r=auditMonitoring({...f,read:(args:string[])=>readAuditAwsJson(args,execute)});
  expect(r.passed).toBe(true);expect(r.checks.relayConcurrency).toBe(true);expect(JSON.stringify(r)).not.toContain('PRIVATE_');
});
it.each([0,1])('actual CLI parse boundary still refuses reserved concurrency %s',async value=>{
  const {auditMonitoring}=await load(),{readAuditAwsJson}=await import(/* @vite-ignore */resolve(__dirname,'../../../scripts/audit-diagnostics.mjs')),f=fixture();
  const execute=(_program:string,argv:string[])=>JSON.stringify(argv[1]==='get-function-concurrency'?{ReservedConcurrentExecutions:value}:f.read(argv.slice(0,-4)));
  const r=auditMonitoring({...f,read:(args:string[])=>readAuditAwsJson(args,execute)});
  expect(r.passed).toBe(false);expect(r.checks.relayConcurrency).toBe(false);
});

it.each([undefined,0,1])('executed monitoring audit handles actual CLI empty or reserved=%s without weakening the gate',async reserved=>{
 const {auditMonitoring}=await load(),f=fixture(),responses:Record<string,any>={};
 auditMonitoring({...f,read:(args:string[])=>{const value=f.read(args);responses[JSON.stringify(args)]={json:value};return value;}});
 responses[JSON.stringify(['lambda','get-function-concurrency','--function-name',f.relay.FunctionName])]=reserved===undefined?{stdout:''}:{json:{ReservedConcurrentExecutions:reserved}};
 const r=executeAuditCli('monitoring-audit.mjs',{outputs:f.outputs,responses,env:{WAKA_DISCORD_WEBHOOK_URL:f.webhook}}),report=JSON.parse(r.stdout);
 expect(r.status).toBe(reserved===undefined?0:1);expect(report.passed).toBe(reserved===undefined);expect(report.checks.relayConcurrency).toBe(reserved===undefined);
 if(reserved!==undefined)expect(r.stderr).toContain('failed checks=relayConcurrency');
 expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
it('executed monitoring gate names each failed check while preserving the full safe report',async()=>{
 const {auditMonitoring}=await load(),f=fixture(),responses:Record<string,any>={};
 f.policy.Statement[0].Resource='*';f.alarms[0].ActionsEnabled=false;
 auditMonitoring({...f,read:(args:string[])=>{const value=f.read(args);responses[JSON.stringify(args)]={json:value};return value;}});
 const r=executeAuditCli('monitoring-audit.mjs',{outputs:f.outputs,responses,env:{WAKA_DISCORD_WEBHOOK_URL:f.webhook}}),report=JSON.parse(r.stdout);
 expect(r.status).toBe(1);expect(report.checks.relayRole).toBe(false);expect(report.checks.alarmActions).toBe(false);
 expect(r.stderr).toContain('failed checks=relayRole,alarmActions');expect(r.stderr).toContain('production-monitoring-audit.json');
 expect(r.stderr).not.toContain('arn:');expect(r.stdout+r.stderr).not.toContain(f.webhook);
});
