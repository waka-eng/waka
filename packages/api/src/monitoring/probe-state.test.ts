import {describe,it,expect,vi,afterEach} from 'vitest';
import {DynamoDBClient,UpdateItemCommand,GetItemCommand} from '@aws-sdk/client-dynamodb';
import {nextProbeState,probeStore,API_FAILURE_COOLDOWN_MS,API_RECOVERY_CONFIRM_MS,type ProbeState,type ProbeStore} from './probe-state.js';
import {probe} from './uptime.js';
const start=Date.parse('2026-11-11T23:00:00Z');
afterEach(()=>vi.restoreAllMocks());
describe('durable API failure cooldown',()=>{
  it('requires two spaced healthy observations; a single success does not restore expensive failure cadence',()=>{
    const failed=nextProbeState(null,false,start);expect(failed.nextApiAt).toBe(start+API_FAILURE_COOLDOWN_MS);
    const first=nextProbeState(failed,true,failed.nextApiAt);expect(first.status).toBe('recovering');expect(first.nextApiAt).toBe(failed.nextApiAt+API_RECOVERY_CONFIRM_MS);
    const second=nextProbeState(first,true,first.nextApiAt);expect(second.status).toBe('healthy');
    expect(nextProbeState(first,false,first.nextApiAt).nextApiAt).toBe(first.nextApiAt+API_FAILURE_COOLDOWN_MS);
  });
  it.each(['all_fail','chatter'])('bounds full-timeout attempts over 31 days under %s, across restarts',scenario=>{
    let state:ProbeState|null=null,failed=0,healthy=0;
    for(let n=0;n<31*24*12;n++){
      const now=start+n*300000;if(state&&state.nextApiAt>now)continue;
      const success=scenario==='chatter'&&(failed+healthy)%2===1;
      if(success)healthy++;else failed++;
      // JSON round trips discard process state: only persisted fields matter.
      state=JSON.parse(JSON.stringify(nextProbeState(state,success,now)));
    }
    expect(failed).toBeLessThanOrEqual(373);expect(healthy).toBeLessThanOrEqual(31*24*12);
    expect(failed*60*0.0000166667).toBeLessThan(0.374);
  });
  it('checks root every run but skipped API remains degraded and sends no API request',async()=>{
    const store:ProbeStore={claim:async()=>null,settle:vi.fn()};const http=vi.fn(async(_url:Parameters<typeof fetch>[0])=>new Response('<div id="root"></div>'));
    expect(await probe(http,store,start)).toBe(false);expect(http).toHaveBeenCalledTimes(1);expect(http.mock.calls[0][0]).toBe('https://waka.im/');expect(store.settle).not.toHaveBeenCalled();
  });
  it('actual adapter persists a two-hour conservative deadline before I/O and fences settlement by token',async()=>{
    const send=vi.spyOn(DynamoDBClient.prototype,'send').mockImplementation(async()=>({$metadata:{}}));
    const store=probeStore('local-test');const claim=await store.claim(start);expect(claim).toBeTruthy();
    const command=send.mock.calls[1][0] as UpdateItemCommand;
    expect(command.input.ExpressionAttributeValues?.[':next']).toEqual({N:String(start+API_FAILURE_COOLDOWN_MS)});
    expect(command.input.ConditionExpression).toContain('nextApiAt <= :now');expect(command.input.ConditionExpression).toContain('leaseUntil <= :now');
    await store.settle(claim!,nextProbeState(null,false,start));expect((send.mock.calls.at(-1)![0] as UpdateItemCommand).input.ConditionExpression).toBe('leaseToken=:token');
  });
  it('survives interrupted attempt/restart and refuses storage failure before API dispatch',async()=>{
    const send=vi.spyOn(DynamoDBClient.prototype,'send').mockImplementation(async(command:any)=>{
      if(command instanceof GetItemCommand)return {$metadata:{},Item:{nextApiAt:{N:String(start+API_FAILURE_COOLDOWN_MS)},status:{S:'checking'}}};
      throw Error('Unexpected write while cooling');
    });
    expect(await probeStore('local-test').claim(start+60000)).toBeNull();expect(send).toHaveBeenCalledTimes(1);
    const http=vi.fn(async(_url:Parameters<typeof fetch>[0])=>new Response('<div id="root"></div>'));
    send.mockRejectedValue(Error('Dynamo unavailable'));
    await expect(probe(http,probeStore('local-test'),start)).rejects.toThrow();expect(http).toHaveBeenCalledTimes(1);
  });
});
