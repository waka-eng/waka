import {randomUUID} from 'node:crypto';
import {DynamoDBClient,PutItemCommand,GetItemCommand,UpdateItemCommand} from '@aws-sdk/client-dynamodb';
import {discordDestination} from './protocol.js';
import {readBudgetNotice,budgetDiscordPayload,type BudgetNotice} from './budget-protocol.js';

export const BUDGET_LEASE_MS=30000;
export interface BudgetStore {
  remember(notice:BudgetNotice,now:number):Promise<void>;
  claim(notice:BudgetNotice,token:string,now:number):Promise<{token:string;until:number}|null>;
  defer(notice:BudgetNotice,token:string,until:number,now:number):Promise<void>;
  settle(notice:BudgetNotice,token:string,now:number):Promise<void>;
}
/** One-way notices need no ALARM/OK head or cross-alarm ordering. Intent and a
 * durable claim precede I/O; 30s lease exceeds the entire 20s Lambda lifetime.
 * A crash after external acceptance but before settlement may duplicate a POST. */
export async function deliverBudgetNotice(notice:BudgetNotice,store:BudgetStore,destination:string,fetcher:typeof fetch=fetch,clock:()=>number=Date.now){
  await store.remember(notice,clock());
  const token=randomUUID(),claim=await store.claim(notice,token,clock());
  if(!claim)return;
  const url=discordDestination(destination),body=JSON.stringify(budgetDiscordPayload(notice));
  if(claim.token!==token||claim.until<=clock())throw Error('budget_delivery_lease_expired');
  let response:Response;
  try{response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body});}
  catch{throw Error('budget_delivery_transport');}
  try{await response.body?.cancel();}catch{/* Never read/log a Discord body. */}
  if(response.status===429){
    const seconds=Number(response.headers.get('Retry-After')??60),now=clock();
    await store.defer(notice,token,now+Math.min(3600000,Math.max(60000,Number.isFinite(seconds)?seconds*1000:60000)),now);
  }
  if(!response.ok)throw Error(response.status===429?'budget_delivery_rate_limited':response.status>=500?'budget_delivery_unavailable':'budget_delivery_rejected');
  await store.settle(notice,token,clock());
}
const client=new DynamoDBClient({maxAttempts:1});
const conditional=(error:unknown)=>(error as {name?:string})?.name==='ConditionalCheckFailedException';
export function budgetStore(table:string,db:DynamoDBClient=client):BudgetStore {
  const key=(id:string)=>({id:{S:id}});
  const values=(token:string,now:number)=>({':token':{S:token},':now':{N:String(now)},':pending':{S:'pending'}});
  return {
    async remember(notice,now){
      try{await db.send(new PutItemCommand({TableName:table,Item:{...key(notice.id),kind:{S:notice.kind},timestamp:{N:String(notice.timestamp)},status:{S:'pending'},expires:{N:String(Math.floor(now/1000)+90*86400)}},ConditionExpression:'attribute_not_exists(id)'}));}
      catch(error){if(!conditional(error))throw Error('budget_intent_storage');}
    },
    async claim(notice,token,now){
      let row;
      try{
        row=(await db.send(new UpdateItemCommand({TableName:table,Key:key(notice.id),ReturnValues:'ALL_NEW',UpdateExpression:'SET leaseToken=:token, leaseUntil=:until',ConditionExpression:'#s=:pending AND (attribute_not_exists(leaseUntil) OR leaseUntil<=:now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{...values(token,now),':until':{N:String(now+BUDGET_LEASE_MS)}}}))).Attributes;
      }catch(error){
        if(!conditional(error))throw Error('budget_claim_storage');
        try{row=(await db.send(new GetItemCommand({TableName:table,Key:key(notice.id),ConsistentRead:true}))).Item;}
        catch{throw Error('budget_claim_storage');}
        if(row?.status?.S==='sent')return null;
        throw Error('budget_delivery_leased');
      }
      if(row?.leaseToken?.S!==token||Number(row?.leaseUntil?.N)!==now+BUDGET_LEASE_MS||row?.status?.S!=='pending')throw Error('budget_claim_storage');
      return {token,until:now+BUDGET_LEASE_MS};
    },
    async defer(notice,token,until,now){
      try{await db.send(new UpdateItemCommand({TableName:table,Key:key(notice.id),UpdateExpression:'SET leaseUntil=:until',ConditionExpression:'leaseToken=:token AND leaseUntil>:now AND #s=:pending',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{...values(token,now),':until':{N:String(until)}}}));}
      catch{throw Error('budget_defer_storage');}
    },
    async settle(notice,token,now){
      try{await db.send(new UpdateItemCommand({TableName:table,Key:key(notice.id),UpdateExpression:'SET #s=:sent, deliveredAt=:now REMOVE leaseToken, leaseUntil',ConditionExpression:'leaseToken=:token AND leaseUntil>:now AND #s=:pending',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{...values(token,now),':sent':{S:'sent'}}}));}
      catch{throw Error('budget_settle_storage');}
    },
  };
}
export async function handler(event:unknown){
  if(process.env.WAKA_STAGE!=='production')return;
  try{
    const notice=readBudgetNotice(event,process.env.BUDGET_ACCOUNT??'',process.env.AWS_REGION??'',process.env.BUDGET_TOPIC_ARN??'');
    if(!notice)throw Error('budget_notice_invalid');
    await deliverBudgetNotice(notice,budgetStore(process.env.MONITOR_TABLE??''),process.env.WAKA_DISCORD_WEBHOOK_URL??'');
  }catch(error){
    const code=error instanceof Error&&/^budget_[a-z_]+$/.test(error.message)?error.message:'budget_runtime_failure';
    console.warn(JSON.stringify({event:'budget_delivery_failure',code}));throw Error(code);
  }
}
