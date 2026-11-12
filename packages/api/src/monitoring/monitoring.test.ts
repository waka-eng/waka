import { describe, it, expect, vi, afterEach } from 'vitest';
import { readTransition, discordDestination, discordPayload, alarmLabels, type AlarmTransition } from './protocol.js';
import { deliver, dynamoStore, handler, SEND_GATE, SEND_LEASE_MS, type DeliveryStore } from './relay.js';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { probe } from './uptime.js';
const freshProbeStore=()=>({claim:async()=>({token:'local',prior:null}),settle:async()=>{}});
import { recordOperationalFault } from '../lib/operational-fault.js';

const now = Date.parse('2026-11-11T20:00:00Z');
const account = '111122223333';
const destination = 'https://discord.com/api/webhooks/123456789/fake_local_test_token';
function event(state='ALARM', timestamp=now) { return {source:'aws.cloudwatch',accountId:account,region:'us-west-2',alarmArn:`arn:aws:cloudwatch:us-west-2:${account}:alarm:waka-production-ApplicationFault`,alarmData:{alarmName:'waka-production-ApplicationFault',state:{value:state,timestamp:new Date(timestamp).toISOString(),reason:'PRIVATE_CANARY account email memory'},previousState:{value:'ALARM'}}}; }
const transition = () => readTransition(event(),account,'us-west-2',now)!;
class Store implements DeliveryStore {
  intents = new Map<string,{status:string;lease:number;token?:string}>();
  heads = new Map<string,{timestamp:number;eventId?:string;token:string;until:number}>();
  crashBeforeCheckpoint=false; crashAfterCheckpoint=false; crashBeforeEventSettle=false;
  async remember(t: AlarmTransition) { if(!this.intents.has(t.id)) this.intents.set(t.id,{status:'pending',lease:0}); }
  async claim(t:AlarmTransition,token:string,n:number) { const row=this.intents.get(t.id)!; if(row.status!=='pending') return false; if(row.lease>n) throw Error('monitor_delivery_leased'); Object.assign(row,{lease:n+SEND_LEASE_MS,token}); return true; }
  async claimHead(t:AlarmTransition,token:string,n:number) {
    const row=this.heads.get(t.alarm)??{timestamp:0,token:'',until:0};
    if(row.until>n)throw Error('monitor_alarm_leased');
    Object.assign(row,{token,until:n+SEND_LEASE_MS});this.heads.set(t.alarm,row);return {...row};
  }
  event(t:AlarmTransition,token:string,n:number) { const row=this.intents.get(t.id)!;if(row.token!==token||row.lease<=n||row.status!=='pending')throw Error('event_fence');return row; }
  head(t:AlarmTransition,token:string,n:number) { const row=this.heads.get(t.alarm)!;if(row.token!==token||row.until<=n)throw Error('head_fence');return row; }
  async defer(t:AlarmTransition,token:string,until:number,n:number) { this.event(t,token,n).lease=until; }
  async checkpoint(t:AlarmTransition,token:string,n:number) {
    const row=this.head(t,token,n);if(row.timestamp>t.timestamp)throw Error('head_order');
    if(this.crashBeforeCheckpoint)throw Error('injected_checkpoint_failure');
    Object.assign(row,{timestamp:t.timestamp,eventId:t.id});
    if(this.crashAfterCheckpoint)throw Error('injected_after_checkpoint');
  }
  async settle(t:AlarmTransition,token:string,sent:boolean,n:number) { if(this.crashBeforeEventSettle)throw Error('injected_settlement_failure');this.event(t,token,n).status=sent?'sent':'obsolete'; }
  async releaseHead(t:AlarmTransition,token:string,n:number) { Object.assign(this.head(t,token,n),{until:0,token:''}); }
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('strict content-free alarm protocol',()=>{
  it('binds exact stage, ARN, source account, region and fixed name',()=>{
    expect(transition()).toBeTruthy();
    for(const patch of [{source:'aws.sns'},{accountId:'999988887777'},{region:'eu-west-1'},{alarmArn:'arn:aws:cloudwatch:us-west-2:111122223333:alarm:waka-development-ApplicationFault'},{alarmData:{...event().alarmData,alarmName:'private arbitrary name'}}]) expect(readTransition({...event(),...patch},account,'us-west-2',now)).toBeNull();
    expect(readTransition(event('ALARM',now+600000),account,'us-west-2',now)).toBeNull();
    expect(readTransition({...event('OK'),alarmData:{...event('OK').alarmData,previousState:{value:'INSUFFICIENT_DATA'}}},account,'us-west-2',now)).toBeNull();
  });
  it('excludes all raw reason/event content and disables mentions',()=>{
    const payload=discordPayload(transition());expect(JSON.stringify(payload)).not.toContain('PRIVATE_CANARY');expect(payload.allowed_mentions.parse).toEqual([]);
    expect(discordDestination(destination)).toMatch(/\?wait=true$/);
    for(const url of ['http://discord.com/api/webhooks/1/a','https://discord.com.evil/api/webhooks/1/a',destination+'?thread_id=private',destination+'#private','https://user:password@discord.com/api/webhooks/1/a']) expect(()=>discordDestination(url)).toThrow('monitor_destination_invalid');
  });
});
describe('durable delivery lifecycle across invocations',()=>{
  it('persists before I/O, deduplicates two clients and replay',async()=>{
    const s=new Store(),t=transition();let finish!:()=>void;const wait=new Promise<void>(r=>{finish=r;});
    const fetcher=vi.fn(async()=>{expect(s.intents.get(t.id)?.status).toBe('pending');await wait;return new Response(null,{status:200});});
    const first=deliver(t,s,destination,fetcher,()=>now);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(deliver(t,s,destination,fetcher,()=>now)).rejects.toThrow('leased');finish();await first;
    await deliver(t,s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([429,500])('retains pending intent on HTTP %s and recovers expired claims',async status=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>new Response('PRIVATE_DISCORD_BODY',{status,headers:{'Retry-After':'120'}}));
    await expect(deliver(t,s,destination,fetcher,()=>now)).rejects.toThrow(/^monitor_delivery_/);
    expect(s.intents.get(t.id)?.status).toBe('pending');
    await expect(deliver(t,s,destination,fetcher,()=>now+1000)).rejects.toThrow('leased');expect(fetcher).toHaveBeenCalledTimes(1);
    await deliver(t,s,destination,vi.fn(async()=>new Response(null,{status:200})),()=>now+180000);expect(s.intents.get(t.id)?.status).toBe('sent');
  });
  it('timeout is sanitized, storage failure stops network, and crash before I/O can recover',async()=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>{throw Error(destination+' PRIVATE_CANARY');});
    await expect(deliver(t,s,destination,fetcher,()=>now)).rejects.toThrow('monitor_delivery_transport');
    expect(s.intents.get(t.id)?.status).toBe('pending');
    const blocked = new Store(); blocked.remember=async()=>{throw Error('storage unavailable');};
    await expect(deliver(t,blocked,destination,fetcher,()=>now+60000)).rejects.toThrow('storage unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
    await deliver(t,s,destination,async()=>new Response(null,{status:200}),()=>now+60000);
  });
  it('documents possible duplicate after accepted POST + settlement crash, without losing intent',async()=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>new Response(null,{status:200}));s.crashBeforeCheckpoint=true;
    await expect(deliver(t,s,destination,fetcher,()=>now)).rejects.toThrow('injected_checkpoint_failure');expect(s.intents.get(t.id)?.status).toBe('pending');
    s.crashBeforeCheckpoint=false;await deliver(t,s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('suppresses stale ALARM after newer recovery; duplicates/out-of-order OK cannot reverse state',async()=>{
    const s=new Store(),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    const recovery=readTransition(event('OK',now+1000),account,'us-west-2',now)!;
    await deliver(recovery,s,destination,fetcher,()=>now+2000);await deliver(transition(),s,destination,fetcher,()=>now+3000);
    await deliver(recovery,s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(1);expect(s.intents.get(transition().id)?.status).toBe('obsolete');
  });
  it('retains distinct state intents if service timestamps tie',async()=>{
    const s=new Store(),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    const recovery=readTransition(event('OK'),account,'us-west-2',now)!;
    await deliver(transition(),s,destination,fetcher,()=>now);await deliver(recovery,s,destination,fetcher,()=>now+1);
    await deliver(transition(),s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('actual Dynamo adapter refuses a held claim instead of acknowledging a lost event',async()=>{
    const send=vi.spyOn(DynamoDBClient.prototype,'send');
    send.mockImplementation(async(command:any)=>{
      if(command instanceof UpdateItemCommand)throw Object.assign(Error('conditional'),{name:'ConditionalCheckFailedException'});
      if(command instanceof GetItemCommand)return {Item:{status:{S:'pending'}}};
      return {};
    });
    await expect(dynamoStore('test-delivery').claim(transition(),'token',now)).rejects.toThrow('monitor_delivery_leased');
    const command=send.mock.calls[0][0] as UpdateItemCommand;expect(command.input.ConditionExpression).toContain('leaseUntil <= :now');expect(command.input.ConditionExpression).toContain('#s = :pending');
    send.mockImplementation(async()=>({}));await dynamoStore('test-delivery').remember(transition());
    const intent=send.mock.calls.at(-1)![0] as PutItemCommand;expect(intent.input.ConditionExpression).toBe('attribute_not_exists(id)');
    await dynamoStore('test-delivery').settle(transition(),'token',true,now);
    const settle=send.mock.calls.at(-1)![0] as UpdateItemCommand;expect(settle.input.ConditionExpression).toBe('leaseToken=:token AND leaseUntil > :now AND #s=:pending');
  });
});
describe('per-alarm send ownership without a global bottleneck',()=>{
  const recovery=()=>readTransition(event('OK',now+1000),account,'us-west-2',now)!;
  it('serializes distinct ALARM/OK events for one alarm before checking delivered order',async()=>{
    const s=new Store(),t=transition(),ok=recovery();let finish!:()=>void;
    const wait=new Promise<void>(r=>{finish=r;});
    const fetcher=vi.fn(async(_url:Parameters<typeof fetch>[0],_options?:RequestInit)=>{await wait;return new Response(null,{status:200});});
    const first=deliver(t,s,destination,fetcher,()=>now);
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(deliver(ok,s,destination,fetcher,()=>now+1000)).rejects.toThrow('monitor_alarm_leased');
    expect(s.intents.get(ok.id)?.status).toBe('pending');expect(fetcher).toHaveBeenCalledTimes(1);
    finish();await first;
    await deliver(ok,s,destination,fetcher,()=>now+60000);
    expect(fetcher.mock.calls.map(c=>JSON.parse(c[1]!.body as string).content.includes('Metric back in range'))).toEqual([false,true]);
    expect(s.heads.get(t.alarm)?.timestamp).toBe(ok.timestamp);
  });
  it('admits all eight independent alarms while another same-alarm transition waits',async()=>{
    const s=new Store();let finish!:()=>void;const wait=new Promise<void>(r=>{finish=r;});
    const transitions=Object.keys(alarmLabels).map(code=>({...transition(),id:'event:'+code,alarm:'waka-production-'+code,code:code as keyof typeof alarmLabels}));
    const fetcher=vi.fn(async()=>{await wait;return new Response(null,{status:200});});
    const all=Promise.all(transitions.map(t=>deliver(t,s,destination,fetcher,()=>now)));
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(8));
    await expect(deliver({...transitions[0],id:'event:later',state:'OK',timestamp:now+1},s,destination,fetcher,()=>now+1)).rejects.toThrow('monitor_alarm_leased');
    finish();await all;expect([...s.intents.values()].filter(r=>r.status==='sent')).toHaveLength(8);
  });
  it('retains each rate-limited event in an eight-alarm burst, then recovers without a global gate',async()=>{
    const s=new Store(),transitions=Object.keys(alarmLabels).map(code=>({...transition(),id:'event:'+code,alarm:'waka-production-'+code,code:code as keyof typeof alarmLabels}));
    const fetcher=vi.fn(async()=>new Response(null,{status:429,headers:{'Retry-After':'60'}}));
    const results=await Promise.allSettled(transitions.map(t=>deliver(t,s,destination,fetcher,()=>now)));
    expect(results.every(r=>r.status==='rejected')).toBe(true);expect(fetcher).toHaveBeenCalledTimes(8);
    expect([...s.intents.values()].every(r=>r.status==='pending'&&r.lease===now+60000)).toBe(true);
    expect([...s.heads.values()].every(r=>r.until===0)).toBe(true);
    await Promise.all(transitions.map(t=>deliver(t,s,destination,async()=>new Response(null,{status:200}),()=>now+60000)));
    expect([...s.intents.values()].every(r=>r.status==='sent')).toBe(true);
  });
  it.each(['afterClaim','expiredAdmission','foreignToken'] as const)('retains intent without POST on %s',async fault=>{
    const s=new Store(),original=s.claimHead.bind(s),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    s.claimHead=async(...args)=>{const h=await original(...args);if(fault==='afterClaim')throw Error('injected_after_claim');return {...h,...(fault==='expiredAdmission'?{until:now}:{token:'foreign'})};};
    await expect(deliver(transition(),s,destination,fetcher,()=>now)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();expect(s.intents.get(transition().id)?.status).toBe('pending');
    s.claimHead=original;await deliver(transition(),s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['crashAfterCheckpoint','crashBeforeEventSettle'] as const)('repairs %s without another POST',async fault=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>new Response(null,{status:200}));s[fault]=true;
    await expect(deliver(t,s,destination,fetcher,()=>now)).rejects.toThrow('injected_');
    expect(s.intents.get(t.id)?.status).toBe('pending');expect(s.heads.get(t.alarm)?.eventId).toBe(t.id);
    s[fault]=false;await deliver(t,s,destination,fetcher,()=>now+60000);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(s.intents.get(t.id)?.status).toBe('sent');
  });
  it('fences old checkpoint, event settlement and release after a claim expires/replaces',async()=>{
    const s=new Store(),t=transition();await s.remember(t);await s.claim(t,'old',now);await s.claimHead(t,'old',now);
    await s.claim(t,'new',now+SEND_LEASE_MS);await s.claimHead(t,'new',now+SEND_LEASE_MS);
    await expect(s.checkpoint(t,'old',now+SEND_LEASE_MS)).rejects.toThrow('head_fence');
    await expect(s.settle(t,'old',true,now+SEND_LEASE_MS)).rejects.toThrow('event_fence');
    await expect(s.releaseHead(t,'old',now+SEND_LEASE_MS)).rejects.toThrow('head_fence');
    expect(s.heads.get(t.alarm)?.token).toBe('new');expect(s.intents.get(t.id)?.status).toBe('pending');
  });
  it('does not settle a POST after its lease expired even if its token is unreplaced',async()=>{
    const s=new Store();let time=now;
    await expect(deliver(transition(),s,destination,async()=>{time+=SEND_LEASE_MS;return new Response(null,{status:200});},()=>time)).rejects.toThrow('head_fence');
    expect(s.intents.get(transition().id)?.status).toBe('pending');expect(s.heads.get(transition().alarm)?.eventId).toBeUndefined();
  });
  it.each(['timeout','serverError'])('holds uncertain %s until expiry, then suppresses a stale retry',async fault=>{
    const s=new Store(),t=transition(),ok=recovery();
    await expect(deliver(t,s,destination,async()=>{if(fault==='timeout')throw Error('PRIVATE');return new Response(null,{status:500});},()=>now)).rejects.toThrow(/^monitor_delivery_/);
    const fetcher=vi.fn(async()=>new Response(null,{status:200}));
    await expect(deliver(ok,s,destination,fetcher,()=>now+1000)).rejects.toThrow('monitor_alarm_leased');
    await deliver(ok,s,destination,fetcher,()=>now+60000);await deliver(t,s,destination,fetcher,()=>now+60001);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(s.intents.get(t.id)?.status).toBe('obsolete');
  });
  it('persists bounded 429 defer before release; a newer state can proceed without losing pending intent',async()=>{
    const s=new Store(),t=transition(),ok=recovery();
    await expect(deliver(t,s,destination,async()=>new Response(null,{status:429,headers:{'Retry-After':'99999999'}}),()=>now)).rejects.toThrow('rate_limited');
    expect(s.intents.get(t.id)).toMatchObject({status:'pending',lease:now+3600000});expect(s.heads.get(t.alarm)?.until).toBe(0);
    const fetcher=vi.fn(async()=>new Response(null,{status:200}));await deliver(ok,s,destination,fetcher,()=>now+1000);
    await expect(deliver(t,s,destination,fetcher,()=>now+60000)).rejects.toThrow('monitor_delivery_leased');
    await deliver(t,s,destination,fetcher,()=>now+3600000);expect(fetcher).toHaveBeenCalledTimes(1);expect(s.intents.get(t.id)?.status).toBe('obsolete');
  });
  it('does not release a 429 head before defer storage succeeds',async()=>{
    const s=new Store();s.defer=async()=>{throw Error('injected_defer_storage');};
    await expect(deliver(transition(),s,destination,async()=>new Response(null,{status:429}),()=>now)).rejects.toThrow('injected_defer_storage');
    expect(s.intents.get(transition().id)?.status).toBe('pending');expect(s.heads.get(transition().alarm)?.until).toBe(now+SEND_LEASE_MS);
  });
});

// Mock only the AWS transport: the real adapter builds every request below.
// Orchestrator races/faults above exercise an independent ownership store.
function adapterTransport(options:{headBusy?:boolean;eventStatus?:string;headTimestamp?:number;checkpointed?:boolean;badHead?:boolean;failAt?:number}={}) {
  const requests:any[]=[];
  vi.spyOn(DynamoDBClient.prototype,'send').mockImplementation(async function(this:DynamoDBClient,command:any){
    requests.push(command);
    expect(await this.config.maxAttempts()).toBe(1);
    if(requests.length===options.failAt)throw Error('PRIVATE_AWS_BODY');
    if(command instanceof PutItemCommand&&options.eventStatus)throw Object.assign(Error('conditional'),{name:'ConditionalCheckFailedException'});
    if(command instanceof GetItemCommand)return {Item:{status:{S:options.eventStatus??'pending'}}};
    if(command instanceof UpdateItemCommand){
      const input=command.input,v=input.ExpressionAttributeValues!;
      if(input.UpdateExpression==='SET leaseUntil=:until, leaseToken=:token'&&options.eventStatus)throw Object.assign(Error('conditional'),{name:'ConditionalCheckFailedException'});
      if(input.ReturnValues==='ALL_NEW'){
        if(options.headBusy)throw Object.assign(Error('conditional'),{name:'ConditionalCheckFailedException'});
        if(options.badHead)return {Attributes:{}};
        return {Attributes:{sendLeaseToken:v[':token'],sendLeaseUntil:v[':until'],timestamp:{N:String(options.headTimestamp??0)},...(options.checkpointed?{lastDeliveredEventId:{S:transition().id}}:{})}};
      }
    }
    return {};
  });
  return requests;
}
describe('actual Dynamo request protocol and exact operation budget',()=>{
  it.each([['success',6],['replay',3],['busyEvent',3],['busyHead',3],['rateLimited',5],['serverError',3],['stale',5],['checkpointRepair',5]] as const)('%s uses exactly %s SDK requests with retries disabled',async(kind,count)=>{
    const requests=adapterTransport({...(kind==='replay'?{eventStatus:'sent'}:{}),...(kind==='busyEvent'?{eventStatus:'pending'}:{}),headBusy:kind==='busyHead',headTimestamp:kind==='stale'?now+1:0,checkpointed:kind==='checkpointRepair'});
    const fetcher=vi.fn(async()=>new Response(null,{status:kind==='rateLimited'?429:kind==='serverError'?500:200}));
    const work=deliver(transition(),dynamoStore('local-fixture'),destination,fetcher,()=>now);
    if(['busyEvent','busyHead','rateLimited','serverError'].includes(kind))await expect(work).rejects.toThrow(/^monitor_/);else await work;
    expect(requests).toHaveLength(count);expect(requests.length*3000).toBeLessThan(20000);
    if(['replay','busyEvent','busyHead','stale','checkpointRepair'].includes(kind))expect(fetcher).not.toHaveBeenCalled();
  });
  it('atomically claims the ordering snapshot and fences head/event writes with exact tokens and valid expiry',async()=>{
    const requests=adapterTransport();await deliver(transition(),dynamoStore('local-fixture'),destination,async()=>new Response(null,{status:200}),()=>now);
    const [intent,eventClaim,headClaim,checkpoint,settlement,release]=requests.map(c=>c.input);
    expect(intent.ConditionExpression).toBe('attribute_not_exists(id)');
    expect(eventClaim.ConditionExpression).toBe('#s = :pending AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)');
    expect(headClaim).toMatchObject({Key:{id:{S:'head:'+transition().alarm}},ReturnValues:'ALL_NEW',ConditionExpression:'attribute_not_exists(sendLeaseUntil) OR sendLeaseUntil <= :now'});
    expect(headClaim.ExpressionAttributeValues[':until'].N).toBe(String(now+SEND_LEASE_MS));
    const token=headClaim.ExpressionAttributeValues[':token'].S;
    expect(checkpoint.ConditionExpression).toBe('sendLeaseToken=:token AND sendLeaseUntil > :now AND (attribute_not_exists(#ts) OR #ts <= :ts)');
    expect(checkpoint.ExpressionAttributeValues[':event'].S).toBe(transition().id);
    expect(settlement.ConditionExpression).toBe('leaseToken=:token AND leaseUntil > :now AND #s=:pending');
    expect(release).toMatchObject({UpdateExpression:'REMOVE sendLeaseToken, sendLeaseUntil',ConditionExpression:'sendLeaseToken=:token AND sendLeaseUntil > :now'});
    for(const r of [eventClaim,checkpoint,settlement,release])expect(r.ExpressionAttributeValues[':token'].S).toBe(token);
  });
  it.each([1,2,3,4,5,6])('storage failure at request %s stops at that boundary, never acknowledges a pending delivery',async index=>{
    const requests=adapterTransport({failAt:index}),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    await expect(deliver(transition(),dynamoStore('local-fixture'),destination,fetcher,()=>now)).rejects.toThrow(/^monitor_/);
    expect(requests).toHaveLength(index);expect(fetcher).toHaveBeenCalledTimes(index<=3?0:1);
  });
  it('refuses a malformed atomic snapshot before network, and never leaks AWS messages',async()=>{
    const requests=adapterTransport({badHead:true}),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    await expect(deliver(transition(),dynamoStore('local-fixture'),destination,fetcher,()=>now)).rejects.toThrow('monitor_alarm_storage');
    expect(requests).toHaveLength(3);expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['checkpoint','settle','releaseHead'] as const)('propagates a conditional %s refusal rather than accepting obsolete ownership',async method=>{
    const send=vi.spyOn(DynamoDBClient.prototype,'send').mockRejectedValue(Object.assign(Error('PRIVATE_FENCE'),{name:'ConditionalCheckFailedException'}));
    const s=dynamoStore('local-fixture');const work=method==='settle'?s.settle(transition(),'expired',true,now):s[method](transition(),'expired',now);
    await expect(work).rejects.toThrow(/^monitor_/);expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([undefined,'wrong-mode'])('handler fails closed on missing/wrong send gate %s before storage or network',async marker=>{
    vi.stubEnv('WAKA_STAGE','production');vi.stubEnv('AWS_REGION','us-west-2');vi.stubEnv('MONITOR_ACCOUNT',account);vi.stubEnv('MONITOR_SEND_GATE',marker);
    const send=vi.spyOn(DynamoDBClient.prototype,'send'),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);vi.spyOn(console,'warn').mockImplementation(()=>{});
    await expect(handler(event())).rejects.toThrow('monitor_send_gate_invalid');expect(send).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
  it('actual handler with exact guard reaches the six-request protocol using synthetic transport only',async()=>{
    vi.stubEnv('WAKA_STAGE','production');vi.stubEnv('AWS_REGION','us-west-2');vi.stubEnv('MONITOR_ACCOUNT',account);vi.stubEnv('MONITOR_SEND_GATE',SEND_GATE);vi.stubEnv('WAKA_DISCORD_WEBHOOK_URL',destination);vi.stubEnv('MONITOR_TABLE','local-fixture');
    const requests=adapterTransport(),fetcher=vi.fn(async()=>new Response(null,{status:200}));vi.stubGlobal('fetch',fetcher);
    await handler(event());expect(requests).toHaveLength(6);expect(fetcher).toHaveBeenCalledTimes(1);expect(SEND_LEASE_MS).toBe(30000);
  });
});

describe('DB/model-free liveness and fixed metrics',()=>{
  it('checks only fixed unauthenticated targets and refuses redirects/failures/oversized bodies',async()=>{
    const fetcher=vi.fn(async(url:Parameters<typeof fetch>[0],_options?:RequestInit)=>new Response(String(url).endsWith('/health')?'{"ok":true}':'<div id="root"></div>'));
    expect(await probe(fetcher,freshProbeStore())).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
    for(const [url,options] of fetcher.mock.calls){expect(String(url)).toMatch(/^https:\/\/waka.im\/(?:api\/health)?$/);expect(options).toMatchObject({redirect:'error'});expect(options).not.toHaveProperty('credentials');}
    expect(await probe(async()=>new Response(null,{status:302}),freshProbeStore())).toBe(false);
    expect(await probe(async()=>new Response('x'.repeat(65537)),freshProbeStore())).toBe(false);
    expect(await probe(async()=>{throw Error('private network detail');},freshProbeStore())).toBe(false);
  });
  it('emits only one production series with closed code and never private fields',()=>{
    const write=vi.spyOn(process.stdout,'write').mockReturnValue(true);vi.stubEnv('WAKA_STAGE','production');recordOperationalFault('api_5xx');
    const metric=JSON.parse(String(write.mock.calls[0][0]));expect(metric._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Stage']]);expect(Object.keys(metric).sort()).toEqual(['Faults','Stage','_aws','code','event']);
    recordOperationalFault('PRIVATE_CANARY' as any);vi.stubEnv('WAKA_STAGE','development');recordOperationalFault('api_5xx');expect(write).toHaveBeenCalledTimes(1);
  });
});
