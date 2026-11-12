import {expect,it,vi,afterEach} from 'vitest';
import {DynamoDBClient,PutItemCommand,GetItemCommand,UpdateItemCommand} from '@aws-sdk/client-dynamodb';
import {readBudgetNotice,budgetDiscordPayload,BUDGET_SETUP_TEST,type BudgetNotice} from './budget-protocol.js';
import {deliverBudgetNotice,budgetStore,handler,BUDGET_LEASE_MS,type BudgetStore} from './budget-alert.js';
const now=Date.parse('2026-11-12T08:00:00Z'),account='111122223333',topic=`arn:aws:sns:us-west-2:${account}:budget-topic`,destination='https://discord.com/api/webhooks/123456789/fake_local_test_token';
const secret='PRIVATE_CAPTURE person@example.test https://private.invalid/?key=SECRET @everyone';
const event=(message=secret)=>({Records:[{EventSource:'aws:sns',EventVersion:'1.0',Sns:{Type:'Notification',TopicArn:topic,MessageId:'12345678-1234-1234-1234-123456789abc',Timestamp:new Date(now).toISOString(),Message:message,Subject:secret}}]});
const notice=()=>readBudgetNotice(event(),account,'us-west-2',topic,now)!;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
it('separates native budget and labeled setup notice without forwarding any financial/body/subject text',()=>{
 const actual=notice(),setup=readBudgetNotice(event(BUDGET_SETUP_TEST),account,'us-west-2',topic,now)!;
 expect(actual.kind).toBe('actual_cost');expect(setup.kind).toBe('setup_test');
 expect(budgetDiscordPayload(actual).content).toContain('Monthly ACTUAL AWS account cost exceeded $5');
 expect(budgetDiscordPayload(setup).content).toContain('not a $5 spending breach');
 for(const n of [actual,setup]){const payload=budgetDiscordPayload(n);expect(payload.allowed_mentions.parse).toEqual([]);expect(JSON.stringify(payload)).not.toContain('PRIVATE');expect(JSON.stringify(payload)).not.toContain('SECRET');expect(JSON.stringify(n)).not.toContain(account);}
 expect(readBudgetNotice(event('different raw body'),account,'us-west-2',topic,now)?.id).toBe(actual.id);
});
it.each(['topic','source','region','account','type','version','id','future','old','batch','bodyType'])('rejects invalid native envelope %s',kind=>{
 const e:any=event();let a=account,r='us-west-2';
 if(kind==='topic')e.Records[0].Sns.TopicArn+='foreign';if(kind==='source')e.Records[0].EventSource='aws.cloudwatch';
 if(kind==='region')r='us-east-1';if(kind==='account')a='999988887777';if(kind==='type')e.Records[0].Sns.Type='SubscriptionConfirmation';
 if(kind==='version')e.Records[0].EventVersion='2.0';if(kind==='id')e.Records[0].Sns.MessageId=secret;
 if(kind==='future')e.Records[0].Sns.Timestamp=new Date(now+600000).toISOString();if(kind==='old')e.Records[0].Sns.Timestamp=new Date(now-46*86400000).toISOString();
 if(kind==='batch')e.Records.push(e.Records[0]);if(kind==='bodyType')e.Records[0].Sns.Message={text:secret};
 expect(readBudgetNotice(e,a,r,topic,now)).toBeNull();
});
class Store implements BudgetStore {
 row:{status:string;token?:string;until:number}|undefined;failSettle=false;
 async remember(){this.row??={status:'pending',until:0};}
 async claim(_n:BudgetNotice,token:string,time:number){if(this.row?.status==='sent')return null;if(!this.row||this.row.until>time)throw Error('budget_delivery_leased');Object.assign(this.row,{token,until:time+BUDGET_LEASE_MS});return {token,until:this.row.until};}
 fence(token:string,time:number){if(!this.row||this.row.token!==token||this.row.until<=time||this.row.status!=='pending')throw Error('budget_fence');return this.row;}
 async defer(_n:BudgetNotice,token:string,until:number,time:number){this.fence(token,time).until=until;}
 async settle(_n:BudgetNotice,token:string,time:number){if(this.failSettle)throw Error('injected_settlement_failure');this.fence(token,time).status='sent';}
}
it('concurrent duplicate and committed replay issue one POST; a leased attempt cannot be falsely acknowledged',async()=>{
 const s=new Store();let finish!:()=>void;const fetcher=vi.fn(async()=>{await new Promise<void>(r=>{finish=r;});return new Response(null,{status:200});});
 const first=deliverBudgetNotice(notice(),s,destination,fetcher,()=>now);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
 await expect(deliverBudgetNotice(notice(),s,destination,fetcher,()=>now)).rejects.toThrow('leased');finish();await first;
 await deliverBudgetNotice(notice(),s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(1);expect(s.row?.status).toBe('sent');
});
it.each([429,500,400,'timeout'])('retains pending intent after %s and admits recovery only after lease/defer',async status=>{
 const s=new Store(),fetcher=vi.fn(async()=>{if(status==='timeout')throw Error(secret);return new Response(secret,{status:Number(status),headers:{'Retry-After':'120'}});});
 await expect(deliverBudgetNotice(notice(),s,destination,fetcher,()=>now)).rejects.toThrow(/^budget_delivery_/);expect(s.row?.status).toBe('pending');
 await expect(deliverBudgetNotice(notice(),s,destination,fetcher,()=>now+1000)).rejects.toThrow('leased');
 await deliverBudgetNotice(notice(),s,destination,async()=>new Response(null,{status:200}),()=>now+180000);expect(s.row?.status).toBe('sent');
});
it('crash after POST before settlement can duplicate and keeps recoverable intent; expiry/token fencing refuses obsolete claims',async()=>{
 const s=new Store(),fetcher=vi.fn(async()=>new Response(null,{status:200}));s.failSettle=true;
 await expect(deliverBudgetNotice(notice(),s,destination,fetcher,()=>now)).rejects.toThrow('injected_settlement');expect(s.row?.status).toBe('pending');
 const old=s.row!.token!;s.failSettle=false;await deliverBudgetNotice(notice(),s,destination,fetcher,()=>now+60000);expect(fetcher).toHaveBeenCalledTimes(2);
 await expect(s.settle(notice(),old,now+60001)).rejects.toThrow('fence');
});
it('intent/claim storage failure stops before HTTP; expired admission and failed defer never acknowledge delivery',async()=>{
 for(const method of ['remember','claim'] as const){const s=new Store();s[method]=async()=>{throw Error('storage_failure');};const fetcher=vi.fn();await expect(deliverBudgetNotice(notice(),s,destination,fetcher,()=>now)).rejects.toThrow('storage_failure');expect(fetcher).not.toHaveBeenCalled();}
 const expired=new Store();expired.claim=async(_n,token)=>({token,until:now});const fetcher=vi.fn();await expect(deliverBudgetNotice(notice(),expired,destination,fetcher,()=>now)).rejects.toThrow('lease_expired');expect(fetcher).not.toHaveBeenCalled();
 const s=new Store();s.defer=async()=>{throw Error('defer_failure');};await expect(deliverBudgetNotice(notice(),s,destination,async()=>new Response(null,{status:429}),()=>now)).rejects.toThrow('defer_failure');expect(s.row?.status).toBe('pending');
});
function transport(options:{status?:string;failAt?:number;badClaim?:boolean}={}){
 const requests:any[]=[];vi.spyOn(DynamoDBClient.prototype,'send').mockImplementation(async function(this:DynamoDBClient,command:any){
  expect(await this.config.maxAttempts()).toBe(1);requests.push(command);if(requests.length===options.failAt)throw Error(secret);
  if(command instanceof PutItemCommand&&options.status)throw {name:'ConditionalCheckFailedException'};
  if(command instanceof GetItemCommand)return {Item:{status:{S:options.status}}};
  if(command instanceof UpdateItemCommand&&command.input.ReturnValues==='ALL_NEW'){
   if(options.status)throw {name:'ConditionalCheckFailedException'};
   const values=command.input.ExpressionAttributeValues!;return {Attributes:options.badClaim?{}:{leaseToken:values[':token'],leaseUntil:values[':until'],status:{S:'pending'}}};
  }return {};
 });return requests;
}
it.each(['success','replay','leased','rateLimited','serverError'])('actual adapter %s uses at most three SDK requests and only budget keys',async kind=>{
 const requests=transport({status:kind==='replay'?'sent':kind==='leased'?'pending':undefined}),fetcher=vi.fn(async()=>new Response(null,{status:kind==='rateLimited'?429:kind==='serverError'?500:200}));
 const work=deliverBudgetNotice(notice(),budgetStore('synthetic-operational-table'),destination,fetcher,()=>now);
 if(['leased','rateLimited','serverError'].includes(kind))await expect(work).rejects.toThrow(/^budget_/);else await work;
 expect(requests).toHaveLength(kind==='serverError'?2:3);expect(requests.length*90).toBeLessThanOrEqual(270);
 for(const r of requests)expect((r.input.Key??r.input.Item).id.S).toMatch(/^budget:/);
 if(['replay','leased'].includes(kind))expect(fetcher).not.toHaveBeenCalled();
 if(kind==='success'){const [intent,claim,settle]=requests.map(r=>r.input);expect(intent.ConditionExpression).toBe('attribute_not_exists(id)');expect(Number(intent.Item.expires.N)).toBe(Math.floor(now/1000)+90*86400);expect(claim.ReturnValues).toBe('ALL_NEW');expect(settle.ConditionExpression).toContain('leaseToken=:token AND leaseUntil>:now');expect(settle.ExpressionAttributeValues[':token']).toEqual(claim.ExpressionAttributeValues[':token']);}
});
it.each([1,2,3])('actual adapter request failure %s never settles or exports private AWS text',async index=>{
 const requests=transport({failAt:index}),fetcher=vi.fn(async()=>new Response(null,{status:200}));
 await expect(deliverBudgetNotice(notice(),budgetStore('synthetic'),destination,fetcher,()=>now)).rejects.toThrow(/^budget_/);expect(requests).toHaveLength(index);expect(fetcher).toHaveBeenCalledTimes(index===3?1:0);
});
it('actual handler rejects a foreign event before I/O and sends the exact setup label through synthetic transport only',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);vi.stubEnv('WAKA_STAGE','production');vi.stubEnv('AWS_REGION','us-west-2');vi.stubEnv('BUDGET_ACCOUNT',account);vi.stubEnv('BUDGET_TOPIC_ARN',topic);vi.stubEnv('MONITOR_TABLE','synthetic');vi.stubEnv('WAKA_DISCORD_WEBHOOK_URL',destination);
 const requests=transport(),fetcher=vi.fn<typeof fetch>(async()=>new Response(null,{status:200}));vi.stubGlobal('fetch',fetcher);const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 await expect(handler({...event(),Records:[]})).rejects.toThrow('budget_notice_invalid');expect(requests).toHaveLength(0);expect(fetcher).not.toHaveBeenCalled();expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE');
 await handler(event(BUDGET_SETUP_TEST));expect(requests).toHaveLength(3);const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(body.content).toContain('not a $5 spending breach');expect(body.allowed_mentions.parse).toEqual([]);
});
