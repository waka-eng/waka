import {sql} from 'drizzle-orm';
import type {getDb} from './db.js';

type Tx=Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
// Code-pinned request admission, independent of provider slots / job budgets.
export const CHAT_REQUEST_LIMITS={minute:20,hour:120} as const;
export class ChatRateLimitError extends Error {
  readonly code='chat_rate_limited';
  constructor(readonly retryAfterSeconds:number){super('Too many chat requests. Keep your draft and try again shortly.');}
}

/** Call only for a NEW accepted action, in the product mutation transaction.
 * The upsert acquires one account row lock; after waiting, RETURNING observes
 * that latest locked row. Database time is sampled after acquisition. Both
 * windows charge together, or the caller throws and rolls the whole tx back.
 * Product/profile/conversation locks precede this row, and no product locks
 * are acquired afterwards. No second connection, process cache or client IP.
 */
export async function chargeChatRequest(tx:Tx,accountId:string){
  const rows=await tx.execute(sql`
    INSERT INTO account_chat_limits(account_id) VALUES(${accountId}::uuid)
    ON CONFLICT(account_id) DO UPDATE SET account_id=EXCLUDED.account_id
    RETURNING minute_started_at,minute_count,hour_started_at,hour_count,clock_timestamp() AS clock
  `);
  const row=rows[0] as unknown as {minute_started_at:Date|string;minute_count:number;hour_started_at:Date|string;hour_count:number;clock:Date|string};
  const now=new Date(row.clock).getTime();
  const minuteStart=new Date(row.minute_started_at).getTime(),hourStart=new Date(row.hour_started_at).getTime();
  const minuteExpired=now>=minuteStart+60000,hourExpired=now>=hourStart+3600000;
  const minute=minuteExpired?0:row.minute_count,hour=hourExpired?0:row.hour_count;
  if(minute>=CHAT_REQUEST_LIMITS.minute||hour>=CHAT_REQUEST_LIMITS.hour){
    const wait=Math.max(minute>=CHAT_REQUEST_LIMITS.minute?minuteStart+60000-now:0,hour>=CHAT_REQUEST_LIMITS.hour?hourStart+3600000-now:0);
    throw new ChatRateLimitError(Math.max(1,Math.min(3600,Math.ceil(wait/1000))));
  }
  await tx.execute(sql`UPDATE account_chat_limits SET
    minute_started_at=${new Date(minuteExpired?now:minuteStart).toISOString()}::timestamptz,minute_count=${minute+1},
    hour_started_at=${new Date(hourExpired?now:hourStart).toISOString()}::timestamptz,hour_count=${hour+1}
    WHERE account_id=${accountId}::uuid`);
}
