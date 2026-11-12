import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {AWS_BUDGET_NAME,budgetCostTypes} from '../src/monitoring/budget-protocol';
import {executeAuditCli} from './helpers/audit-cli';
const load=()=>import(/* @vite-ignore */resolve(__dirname,'../../../scripts/budget-alert-audit.mjs'));
function fixture(){
 const account='111122223333',topic=`arn:aws:sns:us-west-2:${account}:budget-topic`,fnArn=`arn:aws:lambda:us-west-2:${account}:function:budget-adapter`,budgetArn=`arn:aws:budgets::${account}:budget/${AWS_BUDGET_NAME}`,tableArn=`arn:aws:dynamodb:us-west-2:${account}:table/delivery`,queue=`arn:aws:sqs:us-west-2:${account}:delivery-failed`,webhook='PRIVATE_DISCORD_CREDENTIAL';
 const outputs={budgetAlertFunctionName:'budget-adapter',budgetAlertTopicArn:topic,budgetAlertSubscriptionArn:topic+':12345678-1234-1234-1234-123456789abc',awsBudgetName:AWS_BUDGET_NAME,monitorDeliveryTable:'delivery',monitorDeliveryDlqUrl:'https://sqs.us-west-2.amazonaws.com/'+account+'/delivery-failed'};
 const fn={FunctionName:'budget-adapter',FunctionArn:fnArn,Role:`arn:aws:iam::${account}:role/budget-adapter`,Timeout:20,MemorySize:128,LoggingConfig:{LogGroup:'/aws/lambda/custom-budget'},Environment:{Variables:{WAKA_STAGE:'production',BUDGET_ACCOUNT:account,BUDGET_TOPIC_ARN:topic,MONITOR_TABLE:'delivery',WAKA_DISCORD_WEBHOOK_URL:webhook,SST_RESOURCE_App:JSON.stringify({name:'waka',stage:'production'}),SST_KEY:Buffer.alloc(32,1).toString('base64'),SST_KEY_FILE:'resource.enc'}}};
 const trust={Statement:[{Effect:'Allow',Action:'sts:AssumeRole',Principal:{Service:'lambda.amazonaws.com'}}]};
 const role={Statement:[{Effect:'Allow',Action:['dynamodb:PutItem','dynamodb:GetItem','dynamodb:UpdateItem'],Resource:tableArn,Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['budget:*']},Null:{'dynamodb:LeadingKeys':'false'}}},{Effect:'Allow',Action:'sqs:SendMessage',Resource:queue}]};
 const publish={Statement:[{Effect:'Allow',Principal:{Service:'budgets.amazonaws.com'},Action:'sns:Publish',Resource:topic,Condition:{StringEquals:{'aws:SourceAccount':account},ArnEquals:{'aws:SourceArn':budgetArn}}}]};
 const invoke={Statement:[{Effect:'Allow',Principal:{Service:'sns.amazonaws.com'},Action:'lambda:InvokeFunction',Resource:fnArn,Condition:{StringEquals:{'AWS:SourceAccount':account},ArnLike:{'AWS:SourceArn':topic}}}]};
 const budget:any={BudgetName:AWS_BUDGET_NAME,BudgetType:'COST',TimeUnit:'MONTHLY',BudgetLimit:{Amount:'5.00',Unit:'USD'},CostFilters:{},CostTypes:Object.fromEntries(Object.entries(budgetCostTypes).map(([k,v])=>[k[0].toUpperCase()+k.slice(1),v])),TimePeriod:{Start:'2026-11-01T00:00:00Z',End:'2087-06-15T00:00:00Z'}};
 const notification={NotificationType:'ACTUAL',ComparisonOperator:'GREATER_THAN',Threshold:100,ThresholdType:'PERCENTAGE'};
 const subscription={SubscriptionArn:outputs.budgetAlertSubscriptionArn,TopicArn:topic,Owner:account,Protocol:'lambda',Endpoint:fnArn,PendingConfirmation:'false'};
 const read=(args:string[]):any=>{
  switch(args[1]){
   case'get-caller-identity':return {Account:account};case'get-function-configuration':return fn;case'get-function-concurrency':return {};
   case'list-function-url-configs':return {FunctionUrlConfigs:[]};case'get-queue-attributes':return {Attributes:{QueueArn:queue}};
   case'describe-table':return {Table:{TableArn:tableArn}};case'get-role':return {Role:{Arn:fn.Role,AssumeRolePolicyDocument:trust}};
   case'list-attached-role-policies':return {AttachedPolicies:[{PolicyArn:'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'}]};
   case'list-role-policies':return {PolicyNames:['budget']};case'get-role-policy':return {PolicyDocument:role};
   case'get-function-event-invoke-config':return {MaximumRetryAttempts:2,MaximumEventAgeInSeconds:3600,DestinationConfig:{OnFailure:{Destination:queue}}};
   case'describe-log-groups':{const arn=`arn:aws:logs:us-west-2:${account}:log-group:${fn.LoggingConfig.LogGroup}`;return {logGroups:[{logGroupName:fn.LoggingConfig.LogGroup,arn:arn+':*',logGroupArn:arn,retentionInDays:14}]};}
   case'get-topic-attributes':return {Attributes:{TopicArn:topic,Policy:JSON.stringify(publish)}};
   case'get-subscription-attributes':return {Attributes:subscription};case'get-policy':return {Policy:JSON.stringify(invoke)};
   case'describe-budget':return {Budget:budget};case'describe-notifications-for-budget':return {Notifications:[notification]};
   case'describe-subscribers-for-notification':return {Subscribers:[{SubscriptionType:'SNS',Address:topic}]};case'describe-budget-actions-for-budget':return {Actions:[]};
   case'get-billing-view':return {billingView:{arn:budget.BillingViewArn,billingViewType:'PRIMARY',ownerAccountId:account}};
   default:throw Error('Unexpected synthetic metadata operation');
  }
 };
 return {outputs,webhook,read,fn,trust,role,publish,invoke,budget,notification,subscription,now:Date.parse('2026-11-12T08:00:00Z')};
}
it('accepts account-wide recurring actual5/strict SNS isolation without exposing credentials or financial payloads',async()=>{
 const {auditBudgetAlert}=await load(),f=fixture(),r=auditBudgetAlert(f);expect(r.passed).toBe(true);expect(r.notificationSent).toBe(false);expect(r.billingThresholdDeliveryVerified).toBe(false);expect(r.snsPreAdmissionFailureQueue).toBe(false);expect(JSON.stringify(r)).not.toContain('PRIVATE');
 f.budget.BillingViewArn='arn:aws:billing::111122223333:billingview/primary';expect(auditBudgetAlert(f).checks.accountScope).toBe(true);
});
it('accepts the actual AWS omitted percentage default and still verifies the exact SNS subscriber',async()=>{
 const {auditBudgetAlert}=await load();
 for(const omitted of [true,false]){
  const f=fixture(),seen:string[][]=[];
  if(omitted)delete(f.notification as any).ThresholdType;else(f.notification as any).ThresholdType=undefined;
  const r=auditBudgetAlert({...f,read:(args:string[])=>{seen.push(args);return f.read(args);}});
  expect(r.passed).toBe(true);expect(r.checks.oneActualThreshold).toBe(true);expect(r.checks.oneSnsSubscriber).toBe(true);
  const subscriber=seen.find(args=>args[1]==='describe-subscribers-for-notification');expect(subscriber).toBeDefined();
  expect(JSON.parse(subscriber![subscriber!.indexOf('--notification')+1])).toEqual({NotificationType:'ACTUAL',ComparisonOperator:'GREATER_THAN',Threshold:100,ThresholdType:'PERCENTAGE'});
 }
});
it.each(['ABSOLUTE_VALUE',null,'','unknown',100])('refuses explicit non-percentage or malformed threshold type %j',async value=>{
 const {auditBudgetAlert}=await load(),f=fixture();(f.notification as any).ThresholdType=value;
 const r=auditBudgetAlert(f);expect(r.passed).toBe(false);expect(r.checks.oneActualThreshold).toBe(false);expect(r.checks.oneSnsSubscriber).toBe(false);
});
it('executed audit CLI accepts the omitted wire field without fabricating billing delivery proof',async()=>{
 const {auditBudgetAlert}=await load(),f=fixture(),responses:Record<string,any>={};delete(f.notification as any).ThresholdType;
 auditBudgetAlert({...f,read:(args:string[])=>{const value=f.read(args);responses[JSON.stringify(args)]={json:value};return value;}});
 const r=executeAuditCli('budget-alert-audit.mjs',{outputs:f.outputs,responses,env:{WAKA_DISCORD_WEBHOOK_URL:f.webhook}}),report=JSON.parse(r.stdout);
 expect(r.status).toBe(0);expect(report.passed).toBe(true);expect(Object.keys(report.checks)).toHaveLength(19);expect(report.checks.oneSnsSubscriber).toBe(true);
 expect(report.notificationSent).toBe(false);expect(report.billingThresholdDeliveryVerified).toBe(false);expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
it.each(['wrongLimit','forecast','prodFilter','creditExcluded','expiring','extraModel','rootTrust','foreignKey','wildcardPublish','foreignSource','foreignInvoke','pendingSubscription','filteredSubscription','publicEndpoint','reserved','actions','customView','fifoTopic'])('refuses unsafe budget setup %s',async kind=>{
 const {auditBudgetAlert}=await load(),f=fixture();
 if(kind==='wrongLimit')f.budget.BudgetLimit.Amount='50';if(kind==='forecast')f.notification.NotificationType='FORECASTED';
 if(kind==='prodFilter')f.budget.CostFilters={TagKeyValue:['Stage$production']};if(kind==='creditExcluded')f.budget.CostTypes.IncludeCredit=false;
 if(kind==='expiring')f.budget.TimePeriod.End='2026-12-01T00:00:00Z';if(kind==='extraModel')Object.assign(f.fn.Environment.Variables,{OPENROUTER_API_KEY:'PRIVATE_MODEL'});
 if(kind==='rootTrust')f.trust.Statement[0].Principal={Service:'lambda.amazonaws.com',AWS:'*'} as any;
 if(kind==='foreignKey')f.role.Statement[0].Condition!['ForAllValues:StringLike']['dynamodb:LeadingKeys']=['event:*'];
 if(kind==='wildcardPublish')f.publish.Statement[0].Resource='*';if(kind==='foreignSource')f.publish.Statement[0].Condition.ArnEquals['aws:SourceArn']='*';
 if(kind==='foreignInvoke')f.invoke.Statement[0].Condition.ArnLike['AWS:SourceArn']=f.outputs.budgetAlertTopicArn+'other';
 if(kind==='pendingSubscription')f.subscription.PendingConfirmation='true';if(kind==='filteredSubscription')Object.assign(f.subscription,{FilterPolicy:'{}'});
 if(kind==='customView')f.budget.BillingViewArn='arn:aws:billing::111122223333:billingview/custom';
 const read=(args:string[])=>{
  if(kind==='publicEndpoint'&&args[1]==='list-function-url-configs')return {FunctionUrlConfigs:[{}]};
  if(kind==='reserved'&&args[1]==='get-function-concurrency')return {ReservedConcurrentExecutions:0};
  if(kind==='actions'&&args[1]==='describe-budget-actions-for-budget')return {Actions:[{}]};
  if(kind==='customView'&&args[1]==='get-billing-view')return {billingView:{arn:f.budget.BillingViewArn,billingViewType:'CUSTOM',ownerAccountId:'111122223333'}};
  if(kind==='fifoTopic'&&args[1]==='get-topic-attributes')return {Attributes:{...f.read(args).Attributes,FifoTopic:'true'}};
  return f.read(args);
 };
 expect(auditBudgetAlert({...f,read}).passed).toBe(false);
});
it('executed audit CLI retains safe failure JSON and identifies missing budget administration access',async()=>{
 const {auditBudgetAlert}=await load(),f=fixture(),responses:Record<string,any>={};
 auditBudgetAlert({...f,read:(args:string[])=>{const value=f.read(args);responses[JSON.stringify(args)]={json:value};return value;}});
 for(const [key]of Object.entries(responses))if(JSON.parse(key)[1]==='describe-budget')responses[key]={status:254,stderr:'An error occurred (AccessDeniedException): PRIVATE_ACCOUNT_SECRET'};
 const r=executeAuditCli('budget-alert-audit.mjs',{outputs:f.outputs,responses,env:{WAKA_DISCORD_WEBHOOK_URL:f.webhook}});
 expect(r.status).toBe(1);expect(JSON.parse(r.stdout).failure).toMatchObject({phase:'budget_alert_audit',kind:'aws_read_failed',operation:'budgets:describe-budget'});expect(r.stderr).toContain('Safe JSON: production-budget-alert-audit.json');expect(r.stdout+r.stderr).not.toContain('PRIVATE');
});
it('uses an explicit successful nonempty CLI query for legitimate zero URL/action lists',async()=>{
 const {auditBudgetAlert}=await load(),f=fixture(),seen:string[][]=[];auditBudgetAlert({...f,read:(args:string[])=>{seen.push(args);return f.read(args);}});
 for(const op of ['list-function-url-configs','describe-budget-actions-for-budget'])expect(seen.find(args=>args[1]===op)).toContain('--query');
 const {readAuditAwsJson}=await import(/* @vite-ignore */resolve(__dirname,'../../../scripts/audit-diagnostics.mjs'));const commands:string[][]=[];
 readAuditAwsJson(['budgets','describe-budget','--account-id','111122223333','--budget-name',AWS_BUDGET_NAME],(_p:string,args:string[])=>{commands.push(args);return '{}';},{region:'us-east-1'});
 expect(commands[0].slice(-4)).toEqual(['--region','us-east-1','--output','json']);
 expect(()=>readAuditAwsJson(['sns','get-topic-attributes'],()=>'',{region:'us-east-1'})).toThrow('audit_boundary_failed');
});
