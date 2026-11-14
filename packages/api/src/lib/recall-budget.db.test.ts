/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real account-wide atomic
 * reservations/rollback/boundaries against disposable PG17, no model HTTP. */
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {reserveRecallAttempt,RECALL_ATTEMPTS_PER_HOUR,RECALL_ATTEMPTS_PER_MINUTE} from './recall-budget.js';
let t:TestDatabase,seq=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function account(){return (await t.sql`INSERT INTO accounts(email) VALUES(${`budget-${++seq}@example.test`}) RETURNING id`)[0]!.id as string;}
it('allows exactly ten competing attempts across the same account, not ten per profile/key',async()=>{
 const id=await account();
 const other=postgres(process.env.DB_CONNECTION_URL!,{max:4,prepare:false,connection:{search_path:t.schemaName}});
 try{
 const parallel=drizzle(other);const results=await Promise.all(Array.from({length:14},(_,i)=>reserveRecallAttempt((i%2?parallel:t.db) as never,id)));
 expect(results.filter(r=>r.allowed)).toHaveLength(RECALL_ATTEMPTS_PER_MINUTE);
 expect(results.filter(r=>!r.allowed).every(r=>r.retryAfter>=1&&r.retryAfter<=60)).toBe(true);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_recall_limits WHERE account_id=${id}`).toEqual([{minute_count:10,hour_count:10}]);
 const otherAccount=await account();expect((await reserveRecallAttempt(t.db as never,otherAccount)).allowed).toBe(true);
 }finally{await other.end();}
});
it('rolls back a reservation transaction and respects elapsed-minute/hour resets',async()=>{
 const id=await account();await expect(t.db.transaction(async tx=>{await reserveRecallAttempt(tx as never,id);throw new Error('rollback');})).rejects.toThrow('rollback');
 expect(await t.sql`SELECT * FROM account_recall_limits WHERE account_id=${id}`).toHaveLength(0);
 await reserveRecallAttempt(t.db as never,id);
 await t.sql`UPDATE account_recall_limits SET minute_started_at=clock_timestamp()-interval '1 minute',minute_count=10,hour_count=${RECALL_ATTEMPTS_PER_HOUR} WHERE account_id=${id}`;
 const blocked=await reserveRecallAttempt(t.db as never,id);expect(blocked.allowed).toBe(false);expect(blocked.retryAfter).toBeGreaterThan(3500);
 await t.sql`UPDATE account_recall_limits SET hour_started_at=clock_timestamp()-interval '1 hour' WHERE account_id=${id}`;
 expect((await reserveRecallAttempt(t.db as never,id)).allowed).toBe(true);
 expect(await t.sql`SELECT minute_count,hour_count FROM account_recall_limits WHERE account_id=${id}`).toEqual([{minute_count:1,hour_count:1}]);
});
