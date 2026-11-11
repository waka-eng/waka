import { randomUUID } from 'node:crypto';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { readTransition, discordDestination, discordPayload, type AlarmTransition } from './protocol.js';

export interface DeliveryStore {
  remember(t: AlarmTransition): Promise<void>;
  deliveredAt(alarm: string): Promise<number>;
  claim(t: AlarmTransition, token: string, now: number): Promise<boolean>;
  defer(t: AlarmTransition, token: string, until: number): Promise<void>;
  settle(t: AlarmTransition, token: string, delivered: boolean): Promise<void>;
}
const conditional = (e: unknown) => (e as {name?:string})?.name === 'ConditionalCheckFailedException';
/** Durable intent precedes external I/O; sent state is never the only record
 * of a pending delivery. A crash after Discord accepts but before settlement
 * can duplicate a message: exactly-once delivery is not claimed. */
export async function deliver(t: AlarmTransition, store: DeliveryStore, destination: string, fetcher: typeof fetch = fetch, now = Date.now()) {
  await store.remember(t);
  const token = randomUUID();
  if (!await store.claim(t, token, now)) return;
  // Timestamp ties are ambiguous, not authority to discard a distinct state.
  if (await store.deliveredAt(t.alarm) > t.timestamp) { await store.settle(t, token, false); return; }
  let response: Response;
  try { response = await fetcher(discordDestination(destination), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: {'Content-Type':'application/json'}, body: JSON.stringify(discordPayload(t)) }); }
  catch { throw Error('monitor_delivery_transport'); }
  // Native async retries (60s/120s), then retained DLQ; never sleep or retry
  // in an invocation, and never log the destination or response body.
  await response.body?.cancel();
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After') ?? 60);
    await store.defer(t, token, now + Math.min(3600000, Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000)));
  }
  if (!response.ok) throw Error(response.status === 429 ? 'monitor_delivery_rate_limited' : response.status >= 500 ? 'monitor_delivery_unavailable' : 'monitor_delivery_rejected');
  await store.settle(t, token, true);
}

const db = new DynamoDBClient({ maxAttempts: 2 });
export function dynamoStore(table: string): DeliveryStore {
  const key = (id: string) => ({ id: { S: id } });
  return {
    async remember(t) {
      try { await db.send(new PutItemCommand({TableName:table,Item:{...key(t.id),alarm:{S:t.alarm},state:{S:t.state},timestamp:{N:String(t.timestamp)},expires:{N:String(Math.floor(t.timestamp/1000)+30*86400)},status:{S:'pending'}},ConditionExpression:'attribute_not_exists(id)'})); }
      catch(e) { if (!conditional(e)) throw Error('monitor_intent_storage'); }
    },
    async deliveredAt(alarm) {
      const r=await db.send(new GetItemCommand({TableName:table,Key:key(`head:${alarm}`),ConsistentRead:true})); return Number(r.Item?.timestamp?.N ?? 0);
    },
    async claim(t, token, now) {
      try { await db.send(new UpdateItemCommand({TableName:table,Key:key(t.id),UpdateExpression:'SET leaseUntil=:until, leaseToken=:token',ConditionExpression:'#s = :pending AND (attribute_not_exists(leaseUntil) OR leaseUntil <= :now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':pending':{S:'pending'},':until':{N:String(now+30000)},':token':{S:token},':now':{N:String(now)}}})); return true; }
      catch(e) {
        if (!conditional(e)) throw Error('monitor_claim_storage');
        const r=await db.send(new GetItemCommand({TableName:table,Key:key(t.id),ConsistentRead:true}));
        if (r.Item?.status?.S === 'sent' || r.Item?.status?.S === 'obsolete') return false;
        throw Error('monitor_delivery_leased');
      }
    },
    async defer(t, token, until) {
      await db.send(new UpdateItemCommand({TableName:table,Key:key(t.id),UpdateExpression:'SET leaseUntil=:until',ConditionExpression:'leaseToken=:token',ExpressionAttributeValues:{':until':{N:String(until)},':token':{S:token}}}));
    },
    async settle(t, token, delivered) {
      if (delivered) {
        try { await db.send(new UpdateItemCommand({TableName:table,Key:key(`head:${t.alarm}`),UpdateExpression:'SET #ts=:ts',ConditionExpression:'attribute_not_exists(#ts) OR #ts < :ts',ExpressionAttributeNames:{'#ts':'timestamp'},ExpressionAttributeValues:{':ts':{N:String(t.timestamp)}}})); }
        catch(e) { if(!conditional(e)) throw Error('monitor_settle_storage'); }
      }
      await db.send(new UpdateItemCommand({TableName:table,Key:key(t.id),UpdateExpression:'SET #s=:status',ConditionExpression:'leaseToken=:token',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':status':{S:delivered?'sent':'obsolete'},':token':{S:token}}}));
    },
  };
}
export async function handler(event: unknown) {
  if (process.env.WAKA_STAGE !== 'production') return;
  const t = readTransition(event, process.env.MONITOR_ACCOUNT ?? '', process.env.AWS_REGION ?? '');
  if (!t) return;
  try { await deliver(t, dynamoStore(process.env.MONITOR_TABLE ?? ''), process.env.WAKA_DISCORD_WEBHOOK_URL ?? ''); }
  catch(e) { const code=e instanceof Error && /^monitor_[a-z_]+$/.test(e.message)?e.message:'monitor_storage_unavailable'; console.warn(JSON.stringify({event:'monitor_delivery_failure',code})); throw Error(code); }
}
