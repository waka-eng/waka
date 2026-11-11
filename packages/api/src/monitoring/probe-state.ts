import {randomUUID} from 'node:crypto';
import {DynamoDBClient,GetItemCommand,UpdateItemCommand} from '@aws-sdk/client-dynamodb';
export const PROBE_KEY='probe:availability';
export const API_FAILURE_COOLDOWN_MS=2*3600000;
export const API_RECOVERY_CONFIRM_MS=30*60000;
export interface ProbeState {status:'healthy'|'unhealthy'|'checking'|'recovering';nextApiAt:number;healthySince:number}
export interface ProbeClaim {token:string;prior:ProbeState|null}
export interface ProbeStore { claim(now:number):Promise<ProbeClaim|null>; settle(claim:ProbeClaim,state:ProbeState):Promise<void> }
export function nextProbeState(prior:ProbeState|null,healthy:boolean,now:number):ProbeState {
  if(!healthy)return {status:'unhealthy',nextApiAt:now+API_FAILURE_COOLDOWN_MS,healthySince:0};
  if(!prior||prior.status==='healthy')return {status:'healthy',nextApiAt:now,healthySince:prior?.healthySince||now};
  const since=prior.status==='recovering'?prior.healthySince:0;
  if(since&&now-since>=API_RECOVERY_CONFIRM_MS)return {status:'healthy',nextApiAt:now,healthySince:since};
  return {status:'recovering',nextApiAt:now+API_RECOVERY_CONFIRM_MS,healthySince:since||now};
}
const db=new DynamoDBClient({maxAttempts:2,requestHandler:{connectionTimeout:1000,requestTimeout:1500}});
export function probeStore(table:string):ProbeStore {
  const key={id:{S:PROBE_KEY}};
  return {
    async claim(now) {
      const existing=await db.send(new GetItemCommand({TableName:table,Key:key,ConsistentRead:true}));
      if(Number(existing.Item?.nextApiAt?.N??0)>now)return null;
      const token=randomUUID();
      try{
        // The conservative failure deadline is committed BEFORE the API GET.
        // Crash/timeout/ambiguous HTTP completion cannot reset the allowance.
        const row=await db.send(new UpdateItemCommand({TableName:table,Key:key,ReturnValues:'ALL_OLD',UpdateExpression:'SET #s=:checking,nextApiAt=:next,leaseUntil=:lease,leaseToken=:token',ConditionExpression:'(attribute_not_exists(nextApiAt) OR nextApiAt <= :now) AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':checking':{S:'checking'},':next':{N:String(now+API_FAILURE_COOLDOWN_MS)},':lease':{N:String(now+90000)},':token':{S:token},':now':{N:String(now)}}}));
        const p=row.Attributes;
        return {token,prior:p?{status:p.status?.S as ProbeState['status'],nextApiAt:Number(p.nextApiAt?.N??0),healthySince:Number(p.healthySince?.N??0)}:null};
      }catch(e){if((e as {name?:string}).name==='ConditionalCheckFailedException')return null;throw Error('monitor_probe_state_unavailable');}
    },
    async settle(claim,state) {
      await db.send(new UpdateItemCommand({TableName:table,Key:key,UpdateExpression:'SET #s=:status,nextApiAt=:next,healthySince=:since,leaseUntil=:zero REMOVE leaseToken',ConditionExpression:'leaseToken=:token',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':status':{S:state.status},':next':{N:String(state.nextApiAt)},':since':{N:String(state.healthySince)},':zero':{N:'0'},':token':{S:claim.token}}}));
    },
  };
}
