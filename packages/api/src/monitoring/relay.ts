import { randomUUID } from 'node:crypto';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { readTransition, discordDestination, discordPayload, type AlarmTransition } from './protocol.js';

export const SEND_GATE = 'alarm-head-v1';
export const SEND_LEASE_MS = 30000;
export interface AlarmHead { token: string; until: number; timestamp: number; eventId?: string }
export interface DeliveryStore {
  remember(t: AlarmTransition): Promise<void>;
  claim(t: AlarmTransition, token: string, now: number): Promise<boolean>;
  claimHead(t: AlarmTransition, token: string, now: number): Promise<AlarmHead>;
  defer(t: AlarmTransition, token: string, until: number, now: number): Promise<void>;
  checkpoint(t: AlarmTransition, token: string, now: number): Promise<void>;
  settle(t: AlarmTransition, token: string, delivered: boolean, now: number): Promise<void>;
  releaseHead(t: AlarmTransition, token: string, now: number): Promise<void>;
}
const conditional = (e: unknown) => (e as {name?:string})?.name === 'ConditionalCheckFailedException';
/** Intent and the per-alarm send claim precede external I/O. The 30s claim
 * exceeds the entire 20s Lambda runtime, not just the 5s HTTP deadline.
 * Discord acceptance cannot be atomic with DynamoDB: a crash before the
 * delivery checkpoint can duplicate a message or leave remote timing unknown. */
export async function deliver(t: AlarmTransition, store: DeliveryStore, destination: string, fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  await store.remember(t);
  const token = randomUUID();
  if (!await store.claim(t, token, clock())) return;
  // ALL_NEW from this conditional write is the ordering snapshot. A separate
  // head read followed by POST would allow a concurrent ALARM/OK to race.
  const head = await store.claimHead(t, token, clock());
  const admission = () => {
    if (head.token !== token || head.until <= clock()) throw Error('monitor_alarm_lease_expired');
  };
  admission();
  // Ties do not establish order. An exact previous checkpoint repairs a crash
  // between head checkpoint and event settlement without another POST.
  if (head.timestamp > t.timestamp || head.eventId === t.id) {
    await store.settle(t, token, head.timestamp <= t.timestamp, clock());
    await store.releaseHead(t, token, clock());
    return;
  }
  let response: Response;
  const url = discordDestination(destination), body = JSON.stringify(discordPayload(t));
  admission(); // no awaited work between this valid claim and network admission
  try { response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: {'Content-Type':'application/json'}, body }); }
  catch { throw Error('monitor_delivery_transport'); }
  await response.body?.cancel();
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After') ?? 60), now = clock();
    await store.defer(t, token, now + Math.min(3600000, Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000)), now);
    await store.releaseHead(t, token, clock());
  }
  // On ambiguous transport/5xx/settlement failure, leave the alarm lease to
  // expire rather than immediately handing off while the POST is uncertain.
  if (!response.ok) throw Error(response.status === 429 ? 'monitor_delivery_rate_limited' : response.status >= 500 ? 'monitor_delivery_unavailable' : 'monitor_delivery_rejected');
  await store.checkpoint(t, token, clock());
  await store.settle(t, token, true, clock());
  await store.releaseHead(t, token, clock());
}

// One SDK request per store operation. Native async retries (60s/120s) and
// retained intent/DLQ handle failure; hidden SDK retries would double the
// reviewed six-request maximum per handler attempt.
const db = new DynamoDBClient({ maxAttempts: 1 });
export function dynamoStore(table: string): DeliveryStore {
  const key = (id: string) => ({ id: { S: id } });
  const update = async (input: ConstructorParameters<typeof UpdateItemCommand>[0], code: string) => {
    try { return await db.send(new UpdateItemCommand(input)); }
    catch { throw Error(code); }
  };
  const eventValues = (token: string, now: number) => ({ ':token': { S: token }, ':now': { N: String(now) }, ':pending': { S: 'pending' } });
  return {
    async remember(t) {
      try { await db.send(new PutItemCommand({TableName:table,Item:{...key(t.id),alarm:{S:t.alarm},state:{S:t.state},timestamp:{N:String(t.timestamp)},expires:{N:String(Math.floor(t.timestamp/1000)+30*86400)},status:{S:'pending'}},ConditionExpression:'attribute_not_exists(id)'})); }
      catch(e) { if (!conditional(e)) throw Error('monitor_intent_storage'); }
    },
    async claim(t, token, now) {
      try { await db.send(new UpdateItemCommand({TableName:table,Key:key(t.id),UpdateExpression:'SET leaseUntil=:until, leaseToken=:token',ConditionExpression:'#s = :pending AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{...eventValues(token,now),':until':{N:String(now+SEND_LEASE_MS)}}})); return true; }
      catch(e) {
        if (!conditional(e)) throw Error('monitor_claim_storage');
        let row;
        try { row = await db.send(new GetItemCommand({TableName:table,Key:key(t.id),ConsistentRead:true})); }
        catch { throw Error('monitor_claim_storage'); }
        if (row.Item?.status?.S === 'sent' || row.Item?.status?.S === 'obsolete') return false;
        throw Error('monitor_delivery_leased');
      }
    },
    async claimHead(t, token, now) {
      let result;
      try { result = await db.send(new UpdateItemCommand({TableName:table,Key:key(`head:${t.alarm}`),ReturnValues:'ALL_NEW',UpdateExpression:'SET sendLeaseUntil=:until, sendLeaseToken=:token',ConditionExpression:'attribute_not_exists(sendLeaseUntil) OR sendLeaseUntil <= :now',ExpressionAttributeValues:{':until':{N:String(now+SEND_LEASE_MS)},':token':{S:token},':now':{N:String(now)}}})); }
      catch(e) { throw Error(conditional(e) ? 'monitor_alarm_leased' : 'monitor_alarm_storage'); }
      const row = result.Attributes, timestamp = row?.timestamp === undefined ? 0 : Number(row.timestamp.N);
      if (row?.sendLeaseToken?.S !== token || Number(row?.sendLeaseUntil?.N) !== now+SEND_LEASE_MS || !Number.isSafeInteger(timestamp) || timestamp < 0 || (row?.lastDeliveredEventId !== undefined && typeof row.lastDeliveredEventId.S !== 'string')) throw Error('monitor_alarm_storage');
      return {token,until:now+SEND_LEASE_MS,timestamp,eventId:row.lastDeliveredEventId?.S};
    },
    async defer(t, token, until, now) {
      await update({TableName:table,Key:key(t.id),UpdateExpression:'SET leaseUntil=:until',ConditionExpression:'leaseToken=:token AND leaseUntil > :now AND #s=:pending',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{...eventValues(token,now),':until':{N:String(until)}}}, 'monitor_defer_storage');
    },
    async checkpoint(t, token, now) {
      await update({TableName:table,Key:key(`head:${t.alarm}`),UpdateExpression:'SET #ts=:ts, lastDeliveredEventId=:event',ConditionExpression:'sendLeaseToken=:token AND sendLeaseUntil > :now AND (attribute_not_exists(#ts) OR #ts <= :ts)',ExpressionAttributeNames:{'#ts':'timestamp'},ExpressionAttributeValues:{':token':{S:token},':now':{N:String(now)},':ts':{N:String(t.timestamp)},':event':{S:t.id}}}, 'monitor_checkpoint_storage');
    },
    async settle(t, token, delivered, now) {
      await update({TableName:table,Key:key(t.id),UpdateExpression:'SET #s=:status',ConditionExpression:'leaseToken=:token AND leaseUntil > :now AND #s=:pending',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{...eventValues(token,now),':status':{S:delivered?'sent':'obsolete'}}}, 'monitor_settle_storage');
    },
    async releaseHead(t, token, now) {
      await update({TableName:table,Key:key(`head:${t.alarm}`),UpdateExpression:'REMOVE sendLeaseToken, sendLeaseUntil',ConditionExpression:'sendLeaseToken=:token AND sendLeaseUntil > :now',ExpressionAttributeValues:{':token':{S:token},':now':{N:String(now)}}}, 'monitor_release_storage');
    },
  };
}
export async function handler(event: unknown) {
  if (process.env.WAKA_STAGE !== 'production') return;
  const t = readTransition(event, process.env.MONITOR_ACCOUNT ?? '', process.env.AWS_REGION ?? '');
  if (!t) return;
  try {
    if (process.env.MONITOR_SEND_GATE !== SEND_GATE) throw Error('monitor_send_gate_invalid');
    await deliver(t, dynamoStore(process.env.MONITOR_TABLE ?? ''), process.env.WAKA_DISCORD_WEBHOOK_URL ?? '');
  }
  catch(e) { const code=e instanceof Error && /^monitor_[a-z_]+$/.test(e.message)?e.message:'monitor_storage_unavailable'; console.warn(JSON.stringify({event:'monitor_delivery_failure',code})); throw Error(code); }
}
