import {createHash} from 'node:crypto';

export const AWS_BUDGET_NAME = 'waka-aws-account-monthly-5';
export const BUDGET_SETUP_TEST = 'WAKA_BUDGET_SETUP_TEST_V1';
export const budgetCostTypes = {
  includeCredit:true,includeDiscount:true,includeOtherSubscription:true,
  includeRecurring:true,includeRefund:true,includeSubscription:true,
  includeSupport:true,includeTax:true,includeUpfront:true,
  useAmortized:false,useBlended:false,
} as const;
export interface BudgetNotice {id:string;timestamp:number;kind:'actual_cost'|'setup_test'}

/** Native SNS invocation only. Raw financial text/subject/URLs never leave this
 * boundary. The sole exact sentinel selects a clearly labeled operator test. */
export function readBudgetNotice(raw:unknown,account:string,region:string,topic:string,now=Date.now()):BudgetNotice|null {
  if(!/^\d{12}$/.test(account)||region!=='us-west-2'||!topic.startsWith(`arn:aws:sns:${region}:${account}:`))return null;
  const records=(raw as {Records?:unknown[]}|null)?.Records;
  if(!Array.isArray(records)||records.length!==1)return null;
  const record=records[0] as Record<string,any>,sns=record?.Sns;
  if(record?.EventSource!=='aws:sns'||record.EventVersion!=='1.0'||sns?.Type!=='Notification'||sns.TopicArn!==topic||
    typeof sns.Message!=='string'||typeof sns.MessageId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sns.MessageId))return null;
  const timestamp=typeof sns.Timestamp==='string'?Date.parse(sns.Timestamp):NaN;
  // Covers SNS's native server-error retry window plus retained async failure
  // recovery. No inference about the billing period from delivery time.
  if(!Number.isFinite(timestamp)||timestamp>now+300000||timestamp<now-45*86400000)return null;
  return {id:'budget:'+createHash('sha256').update(`${topic}:${sns.MessageId}`).digest('hex'),timestamp,
    kind:sns.Message===BUDGET_SETUP_TEST?'setup_test':'actual_cost'};
}
export function budgetDiscordPayload(notice:BudgetNotice){
  return {allowed_mentions:{parse:[]},content:notice.kind==='setup_test'
    ?'WAKA · AWS budget setup test\nSNS → budget adapter → Discord delivery check. This is not a $5 spending breach.\nhttps://console.aws.amazon.com/costmanagement/'
    :'WAKA · AWS budget alert\nMonthly ACTUAL AWS account cost exceeded $5 (all regions and stages). Billing updates are delayed. Notification only; services keep running.\nhttps://console.aws.amazon.com/costmanagement/'};
}
