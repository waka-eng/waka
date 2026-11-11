import { describe, it, expect, vi, afterEach } from 'vitest';
import { readTransition, discordDestination, discordPayload, type AlarmTransition } from './protocol.js';
import { deliver, dynamoStore, type DeliveryStore } from './relay.js';
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
  intents = new Map<string,{status:string;lease:number;token?:string}>(); heads = new Map<string,number>(); crashAfterPost=false;
  async remember(t: AlarmTransition) { if(!this.intents.has(t.id)) this.intents.set(t.id,{status:'pending',lease:0}); }
  async deliveredAt(alarm:string) { return this.heads.get(alarm)??0; }
  async claim(t:AlarmTransition,token:string,n:number) { const row=this.intents.get(t.id)!; if(row.status!=='pending') return false; if(row.lease>n) throw Error('monitor_delivery_leased'); Object.assign(row,{lease:n+30000,token}); return true; }
  async defer(t:AlarmTransition,token:string,until:number) { const row=this.intents.get(t.id)!; expect(row.token).toBe(token);row.lease=until; }
  async settle(t:AlarmTransition,token:string,sent:boolean) { if(this.crashAfterPost) throw Error('injected_settlement_failure'); const row=this.intents.get(t.id)!; expect(row.token).toBe(token);row.status=sent?'sent':'obsolete'; if(sent)this.heads.set(t.alarm,Math.max(this.heads.get(t.alarm)??0,t.timestamp)); }
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
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
    const first=deliver(t,s,destination,fetcher,now);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(deliver(t,s,destination,fetcher,now)).rejects.toThrow('leased');finish();await first;
    await deliver(t,s,destination,fetcher,now+60000);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([429,500])('retains pending intent on HTTP %s and recovers expired claims',async status=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>new Response('PRIVATE_DISCORD_BODY',{status,headers:{'Retry-After':'120'}}));
    await expect(deliver(t,s,destination,fetcher,now)).rejects.toThrow(/^monitor_delivery_/);
    expect(s.intents.get(t.id)?.status).toBe('pending');
    await expect(deliver(t,s,destination,fetcher,now+1000)).rejects.toThrow('leased');expect(fetcher).toHaveBeenCalledTimes(1);
    await deliver(t,s,destination,vi.fn(async()=>new Response(null,{status:200})),now+180000);expect(s.intents.get(t.id)?.status).toBe('sent');
  });
  it('timeout is sanitized, storage failure stops network, and crash before I/O can recover',async()=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>{throw Error(destination+' PRIVATE_CANARY');});
    await expect(deliver(t,s,destination,fetcher,now)).rejects.toThrow('monitor_delivery_transport');
    expect(s.intents.get(t.id)?.status).toBe('pending');
    const blocked = new Store(); blocked.remember=async()=>{throw Error('storage unavailable');};
    await expect(deliver(t,blocked,destination,fetcher,now+60000)).rejects.toThrow('storage unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
    await deliver(t,s,destination,async()=>new Response(null,{status:200}),now+60000);
  });
  it('documents possible duplicate after accepted POST + settlement crash, without losing intent',async()=>{
    const s=new Store(),t=transition(),fetcher=vi.fn(async()=>new Response(null,{status:200}));s.crashAfterPost=true;
    await expect(deliver(t,s,destination,fetcher,now)).rejects.toThrow('injected_settlement_failure');expect(s.intents.get(t.id)?.status).toBe('pending');
    s.crashAfterPost=false;await deliver(t,s,destination,fetcher,now+60000);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('suppresses stale ALARM after newer recovery; duplicates/out-of-order OK cannot reverse state',async()=>{
    const s=new Store(),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    const recovery=readTransition(event('OK',now+1000),account,'us-west-2',now)!;
    await deliver(recovery,s,destination,fetcher,now+2000);await deliver(transition(),s,destination,fetcher,now+3000);
    await deliver(recovery,s,destination,fetcher,now+60000);expect(fetcher).toHaveBeenCalledTimes(1);expect(s.intents.get(transition().id)?.status).toBe('obsolete');
  });
  it('retains distinct state intents if service timestamps tie',async()=>{
    const s=new Store(),fetcher=vi.fn(async()=>new Response(null,{status:200}));
    const recovery=readTransition(event('OK'),account,'us-west-2',now)!;
    await deliver(transition(),s,destination,fetcher,now);await deliver(recovery,s,destination,fetcher,now+1);
    await deliver(transition(),s,destination,fetcher,now+60000);expect(fetcher).toHaveBeenCalledTimes(2);
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
    await dynamoStore('test-delivery').settle(transition(),'token',true);
    const settle=send.mock.calls.at(-1)![0] as UpdateItemCommand;expect(settle.input.ConditionExpression).toBe('leaseToken=:token');
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
