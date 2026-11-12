import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createSourceFile,ScriptKind,ScriptTarget,forEachChild,isVariableDeclaration,transpileModule,ModuleKind} from 'typescript';
import {AWS_BUDGET_NAME,budgetCostTypes} from '../src/monitoring/budget-protocol';
const source=readFileSync(resolve(__dirname,'../../../sst.config.ts'),'utf8'),file=createSourceFile('sst.config.ts',source,ScriptTarget.ESNext,true,ScriptKind.TS),initializers=new Map<string,string>();
function visit(node:any){if(isVariableDeclaration(node)&&node.initializer)initializers.set(node.name.getText(file),node.initializer.getText(file));forEachChild(node,visit);}visit(file);
function context(){
 class Output {constructor(public value:any){}apply(cb:any){return cb(this.value);}}
 class Resource {constructor(public name:string,public args:any,public options:any){}}
 const ctx:any={AWS_REGION:'us-west-2',AWS_BUDGET_NAME,budgetCostTypes,caller:{accountId:new Output('111122223333')},discord:{value:'PRIVATE_WEBHOOK'},deliveryTable:{name:'delivery',arn:'arn:aws:dynamodb:us-west-2:111122223333:table/delivery'},deliveryDlq:{arn:'arn:aws:sqs:us-west-2:111122223333:delivery-failed'},$util:{all:(values:any[])=>new Output(values.map(v=>v instanceof Output?v.value:v))},
 aws:{sns:{TopicPolicy:Resource,TopicSubscription:Resource},lambda:{Permission:Resource},Provider:Resource,budgets:{Budget:Resource}},sst:{aws:{Function:Resource}},
 budgetTopic:{arn:'arn:aws:sns:us-west-2:111122223333:budget-topic'},budgetAlert:{name:new Output('waka-production-BudgetAlertFunction-abcdef01'),arn:null,nodes:{function:{id:'function'},eventInvokeConfig:{id:'async'}}},budgetInvoke:{id:'invoke'},budgetTopicPolicy:{id:'policy'},budgetSubscription:{id:'subscription',arn:'arn:aws:sns:us-west-2:111122223333:budget-topic:12345678-1234-1234-1234-123456789abc'},budgetAsync:{id:'async'},budgetProvider:{id:'global'}};
 return ctx;
}
function evaluate(name:string,ctx:any){const expression=initializers.get(name);expect(expression).toBeDefined();runInNewContext(transpileModule('globalThis.result = '+expression,{compilerOptions:{target:ScriptTarget.ES2022,module:ModuleKind.CommonJS}}).outputText,ctx);return ctx.result;}
it('actual configured budget creates one recurring account-wide actual5 notification after all ready dependencies',()=>{
 const c=context();c.readyBudgetTopic=evaluate('readyBudgetTopic',c);const budget=evaluate('accountBudget',c);
 expect(budget.args).toMatchObject({name:AWS_BUDGET_NAME,budgetType:'COST',limitAmount:'5.00',limitUnit:'USD',timeUnit:'MONTHLY',costFilters:[],costTypes:budgetCostTypes,notifications:[{comparisonOperator:'GREATER_THAN',notificationType:'ACTUAL',threshold:100,thresholdType:'PERCENTAGE',subscriberSnsTopicArns:[c.budgetTopic.arn]}]});
 expect(budget.args.timePeriodStart).toBeUndefined();expect(budget.args.timePeriodEnd).toBeUndefined();expect(budget.args.autoAdjustData).toBeUndefined();
 expect(budget.options.dependsOn).toEqual([c.budgetTopicPolicy,c.budgetInvoke,c.budgetSubscription,c.budgetAlert.nodes.function,c.budgetAsync]);expect(budget.options.retainOnDelete).toBe(true);
 expect(evaluate('budgetProvider',c).args).toEqual({region:'us-east-1'});
});
it('actual ready-topic callback refuses pending/foreign subscriptions before a budget can consume their topic',()=>{
 for(const arn of ['PendingConfirmation','arn:aws:sns:us-east-1:111122223333:foreign:12345678-1234-1234-1234-123456789abc','arn:aws:sns:us-west-2:111122223333:budget-topic:PRIVATE']){const c=context();c.budgetSubscription.arn=arn;expect(()=>evaluate('readyBudgetTopic',c)).toThrow('budget_subscription_unconfirmed');}
});
it('actual SNS and target expressions preserve exact budget/service/account/topic bindings and reject null/foreign identities',()=>{
 const c=context();c.budgetArn=`arn:aws:budgets::111122223333:budget/${AWS_BUDGET_NAME}`;c.budgetTargetArn=evaluate('budgetTargetArn',c);
 expect(c.budgetTargetArn).toBe('arn:aws:lambda:us-west-2:111122223333:function:waka-production-BudgetAlertFunction-abcdef01');expect(c.budgetAlert.arn).toBeNull();
 const policy=JSON.parse(evaluate('budgetTopicPolicy',c).args.policy);expect(policy.Statement).toEqual([{Effect:'Allow',Principal:{Service:'budgets.amazonaws.com'},Action:'sns:Publish',Resource:c.budgetTopic.arn,Condition:{StringEquals:{'aws:SourceAccount':'111122223333'},ArnEquals:{'aws:SourceArn':c.budgetArn}}}]);
 const permission=evaluate('budgetInvoke',c);expect(permission.args).toMatchObject({action:'lambda:InvokeFunction',principal:'sns.amazonaws.com',sourceArn:c.budgetTopic.arn});
 const sub=evaluate('budgetSubscription',c);expect(sub.args).toMatchObject({protocol:'lambda',endpoint:c.budgetTargetArn});expect(sub.options.dependsOn).toEqual([c.budgetAlert.nodes.function,c.budgetInvoke]);
 c.budgetAlert.name.value='foreign:function';expect(()=>evaluate('budgetTargetArn',c)).toThrow('budget_function_identity_invalid');
});
it('actual adapter constructor has only isolated budget keys/secret/async failure scope, Lambda-only trust, and no URL',()=>{
 const c=context(),adapter=evaluate('budgetAlert',c),a=adapter.args;
 expect(a.handler).toBe('packages/api/src/monitoring/budget-alert.handler');expect(a.timeout).toBe('20 seconds');expect(a.memory).toBe('128 MB');expect(a.logging.retention).toBe('2 weeks');expect(a.retries).toBe(2);expect(a.link).toEqual([c.discord]);expect(a.url).toBeUndefined();
 expect(a.permissions).toEqual([{actions:['dynamodb:PutItem','dynamodb:GetItem','dynamodb:UpdateItem'],resources:[c.deliveryTable.arn],conditions:[{test:'ForAllValues:StringLike',variable:'dynamodb:LeadingKeys',values:['budget:*']},{test:'Null',variable:'dynamodb:LeadingKeys',values:['false']}]},{actions:['sqs:SendMessage'],resources:[c.deliveryDlq.arn]}]);
 expect(JSON.parse(a.transform.role.assumeRolePolicy).Statement).toEqual([{Effect:'Allow',Action:'sts:AssumeRole',Principal:{Service:'lambda.amazonaws.com'}}]);expect(a.transform.eventInvokeConfig).toMatchObject({maximumEventAgeInSeconds:3600,destinationConfig:{onFailure:{destination:c.deliveryDlq.arn}}});
 expect(Object.keys(a.environment).sort()).toEqual(['BUDGET_ACCOUNT','BUDGET_TOPIC_ARN','MONITOR_TABLE','WAKA_DISCORD_WEBHOOK_URL','WAKA_STAGE']);
});
