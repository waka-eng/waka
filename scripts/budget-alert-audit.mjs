/** Read-only account-budget acceptance. Never publishes SNS or sends Discord. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AWS_BUDGET_NAME,budgetCostTypes} from '../packages/api/src/monitoring/budget-protocol.ts';
import {isolatedMonitorRole} from './monitoring-audit.mjs';
import {readAuditAwsJson,readAuditOutputs,auditFailure,printAuditReport} from './audit-diagnostics.mjs';
const list=v=>Array.isArray(v)?v:[v];
const document=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
const empty=v=>v==null||(typeof v==='object'&&Object.keys(v).length===0);
const time=v=>typeof v==='number'?v*1000:typeof v==='string'?Date.parse(v):NaN;
export function auditBudgetAlert({outputs,webhook,read,now=Date.now()}){
  const checks={},region='us-west-2',account=read(['sts','get-caller-identity']).Account;
  const fn=read(['lambda','get-function-configuration','--function-name',outputs.budgetAlertFunctionName]);
  const env=fn.Environment?.Variables??{},app=document(env.SST_RESOURCE_App),topic=outputs.budgetAlertTopicArn;
  const budgetArn=`arn:aws:budgets::${account}:budget/${AWS_BUDGET_NAME}`;
  checks.identity=/^\d{12}$/.test(account)&&fn.FunctionName===outputs.budgetAlertFunctionName&&fn.FunctionArn===`arn:aws:lambda:${region}:${account}:function:${fn.FunctionName}`&&app?.name==='waka'&&app.stage==='production';
  const allowed=new Set(['WAKA_STAGE','BUDGET_ACCOUNT','BUDGET_TOPIC_ARN','MONITOR_TABLE','WAKA_DISCORD_WEBHOOK_URL','SST_RESOURCE_App','SST_RESOURCE_DiscordWebhookUrl','SST_KEY','SST_KEY_FILE','NODE_OPTIONS']);
  checks.environment=Object.keys(env).every(k=>allowed.has(k))&&env.WAKA_STAGE==='production'&&env.BUDGET_ACCOUNT===account&&env.BUDGET_TOPIC_ARN===topic&&env.MONITOR_TABLE===outputs.monitorDeliveryTable&&!!webhook&&env.WAKA_DISCORD_WEBHOOK_URL===webhook&&env.SST_KEY_FILE==='resource.enc'&&typeof env.SST_KEY==='string'&&Buffer.from(env.SST_KEY,'base64').length===32&&Buffer.from(env.SST_KEY,'base64').toString('base64')===env.SST_KEY;
  checks.bounds=fn.Timeout===20&&fn.MemorySize===128&&!Object.hasOwn(read(['lambda','get-function-concurrency','--function-name',fn.FunctionName]),'ReservedConcurrentExecutions');
  checks.noPublicEndpoint=(read(['lambda','list-function-url-configs','--function-name',fn.FunctionName,'--query','{FunctionUrlConfigs: FunctionUrlConfigs || `[]`}']).FunctionUrlConfigs??[]).length===0;
  const queue=read(['sqs','get-queue-attributes','--queue-url',outputs.monitorDeliveryDlqUrl,'--attribute-names','QueueArn']).Attributes?.QueueArn;
  const table=read(['dynamodb','describe-table','--table-name',outputs.monitorDeliveryTable]).Table;
  const resources=Object.fromEntries(['dynamodb:PutItem','dynamodb:GetItem','dynamodb:UpdateItem'].map(action=>[action,[table?.TableArn]]));resources['sqs:SendMessage']=[queue];
  checks.operationalScope=table?.TableArn===`arn:aws:dynamodb:${region}:${account}:table/${outputs.monitorDeliveryTable}`&&typeof queue==='string'&&queue.startsWith(`arn:aws:sqs:${region}:${account}:`);
  checks.roleIsolated=typeof fn.Role==='string'&&isolatedMonitorRole(fn.Role,resources,read,{operator:'ForAllValues:StringLike',values:['budget:*']});
  const async=read(['lambda','get-function-event-invoke-config','--function-name',fn.FunctionName]);
  checks.asyncRetention=async.MaximumRetryAttempts===2&&async.MaximumEventAgeInSeconds===3600&&async.DestinationConfig?.OnFailure?.Destination===queue;
  const group=fn.LoggingConfig?.LogGroup,groups=typeof group==='string'?(read(['logs','describe-log-groups','--log-group-name-prefix',group]).logGroups??[]).filter(g=>g.logGroupName===group):[];
  const groupArn=`arn:aws:logs:${region}:${account}:log-group:${group}`;
  checks.logRetention=groups.length===1&&groups[0].arn===groupArn+':*'&&groups[0].logGroupArn===groupArn&&groups[0].retentionInDays===14;
  const attrs=read(['sns','get-topic-attributes','--topic-arn',topic]).Attributes??{};
  const allow=list(document(attrs.Policy)?.Statement??[]).filter(s=>s.Effect==='Allow');
  checks.topicIdentity=typeof topic==='string'&&topic.startsWith(`arn:aws:sns:${region}:${account}:`)&&!topic.endsWith('.fifo')&&attrs.TopicArn===topic&&[undefined,'false'].includes(attrs.FifoTopic)&&!attrs.KmsMasterKeyId;
  checks.topicPublisher=allow.length===1&&allow.every(s=>!s.NotAction&&!s.NotResource&&Object.keys(s.Principal??{}).join()==='Service'&&s.Principal.Service==='budgets.amazonaws.com'&&list(s.Action).join()==='sns:Publish'&&list(s.Resource).join()===topic&&s.Condition?.StringEquals?.['aws:SourceAccount']===account&&s.Condition?.ArnEquals?.['aws:SourceArn']===budgetArn);
  const sub=read(['sns','get-subscription-attributes','--subscription-arn',outputs.budgetAlertSubscriptionArn]).Attributes??{};
  checks.subscription=typeof outputs.budgetAlertSubscriptionArn==='string'&&outputs.budgetAlertSubscriptionArn.startsWith(topic+':')&&sub.SubscriptionArn===outputs.budgetAlertSubscriptionArn&&sub.TopicArn===topic&&sub.Owner===account&&sub.Protocol==='lambda'&&sub.Endpoint===fn.FunctionArn&&sub.PendingConfirmation==='false'&&!sub.FilterPolicy&&!sub.RedrivePolicy;
  const invokes=list(document(read(['lambda','get-policy','--function-name',fn.FunctionName]).Policy)?.Statement??[]).filter(s=>s.Effect==='Allow');
  checks.invokeSource=invokes.length===1&&invokes.every(s=>list(s.Action).join()==='lambda:InvokeFunction'&&list(s.Resource).join()===fn.FunctionArn&&Object.keys(s.Principal??{}).join()==='Service'&&s.Principal.Service==='sns.amazonaws.com'&&s.Condition?.StringEquals?.['AWS:SourceAccount']===account&&(s.Condition?.ArnLike?.['AWS:SourceArn']??s.Condition?.ArnEquals?.['AWS:SourceArn'])===topic);
  const budgetArgs=['--account-id',account,'--budget-name',AWS_BUDGET_NAME],budget=read(['budgets','describe-budget',...budgetArgs]).Budget??{};
  checks.monthlyActualFive=outputs.awsBudgetName===AWS_BUDGET_NAME&&budget.BudgetName===AWS_BUDGET_NAME&&budget.BudgetType==='COST'&&budget.TimeUnit==='MONTHLY'&&Number(budget.BudgetLimit?.Amount)===5&&budget.BudgetLimit?.Unit==='USD'&&!budget.AutoAdjustData&&empty(budget.PlannedBudgetLimits);
  checks.accountScope=empty(budget.CostFilters)&&empty(budget.FilterExpression);
  // Newer Budgets responses can identify a billing view. Accept only the
  // account's unfiltered PRIMARY view, never silently accept a custom scope.
  if(budget.BillingViewArn){
    const view=read(['billing','get-billing-view','--arn',budget.BillingViewArn]).billingView;
    checks.accountScope=checks.accountScope&&view?.arn===budget.BillingViewArn&&view.billingViewType==='PRIMARY'&&view.ownerAccountId===account&&empty(view.dataFilterExpression);
  }
  checks.costTypes=Object.entries(budgetCostTypes).every(([key,value])=>budget.CostTypes?.[key[0].toUpperCase()+key.slice(1)]===value);
  const start=time(budget.TimePeriod?.Start),end=time(budget.TimePeriod?.End),month=new Date(start);
  checks.recurringNoChosenExpiry=Number.isFinite(start)&&start<=now&&month.getUTCDate()===1&&month.getUTCHours()===0&&month.getUTCMinutes()===0&&month.getUTCSeconds()===0&&end===Date.UTC(2087,5,15);
  const notifications=read(['budgets','describe-notifications-for-budget',...budgetArgs]).Notifications??[],notice=notifications[0];
  // AWS omits the percentage default in DescribeNotificationsForBudget;
  // the pinned provider normalizes it too. Explicit null/empty/other types fail.
  const thresholdType=notice?.ThresholdType===undefined?'PERCENTAGE':notice.ThresholdType;
  checks.oneActualThreshold=notifications.length===1&&notice.NotificationType==='ACTUAL'&&notice.ComparisonOperator==='GREATER_THAN'&&thresholdType==='PERCENTAGE'&&notice.Threshold===100;
  if(checks.oneActualThreshold){
    const subscribers=read(['budgets','describe-subscribers-for-notification',...budgetArgs,'--notification',JSON.stringify({NotificationType:'ACTUAL',ComparisonOperator:'GREATER_THAN',Threshold:100,ThresholdType:'PERCENTAGE'})]).Subscribers??[];
    checks.oneSnsSubscriber=subscribers.length===1&&subscribers[0].SubscriptionType==='SNS'&&subscribers[0].Address===topic;
  }else checks.oneSnsSubscriber=false;
  checks.noBudgetActions=(read(['budgets','describe-budget-actions-for-budget',...budgetArgs,'--query','{Actions: Actions || `[]`}']).Actions??[]).length===0;
  return {stage:'production',observedAt:new Date(now).toISOString(),checks,passed:Object.values(checks).every(v=>v===true),notificationSent:false,billingThresholdDeliveryVerified:false,snsPreAdmissionFailureQueue:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{printAuditReport(auditBudgetAlert({outputs:readAuditOutputs(),webhook:process.env.WAKA_DISCORD_WEBHOOK_URL,read:args=>readAuditAwsJson(args,undefined,{region:['budgets','billing'].includes(args[0])?'us-east-1':'us-west-2'})}),'production-budget-alert-audit.json');}
  catch(error){printAuditReport(auditFailure('budget_alert_audit',error,{notificationSent:false,billingThresholdDeliveryVerified:false}),'production-budget-alert-audit.json');}
}
