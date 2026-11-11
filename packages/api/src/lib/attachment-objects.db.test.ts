import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/db.js';
import { drainAttachmentObjects, attachmentKeyHash, prepareAttachmentObjectCleanup, settleAttachmentObjectCleanup, ATTACHMENT_CLEANUP_CLAIM_MS } from './attachment-sweep.js';
import { sweepDeletedShelf } from './deleted-shelf.js';
import { sweepStaleStagedAttachments } from './conversation-attachments.js';
import { eraseAccount } from './account-erasure.js';
import { recordAttachmentUpload, recordAttachmentObjectCreated, UPLOAD_FINALIZATION_GRACE_MS } from './attachment-uploads.js';
import { assertAttachmentKeysUnused } from './inspiration-attachments.js';
import { createAttachmentRoutes } from '../routes/attachments.js';

let t: TestDatabase;
const scope = JSON.stringify({ bucket: 'synthetic', region: 'us-west-2', endpoint: 'http://127.0.0.1:1' });
const now = new Date('2030-01-01T00:00:00Z');
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.cleanup(); });
afterEach(()=>vi.unstubAllEnvs());
async function fixture() {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic') RETURNING id`;
  const [i] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.id},'Synthetic original') RETURNING id`;
  const key = `profiles/${p.id}/attachments/${randomUUID()}`;
  const [attachment] = await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key) VALUES(${p.id},${i.id},'image','https://synthetic.invalid/object',${key}) RETURNING *`;
  // Authoritative synthetic store inventory; never infer this from a key.
  await t.sql`UPDATE attachment_objects SET storage_scope=${scope} WHERE key_hash=${attachmentKeyHash(key)}`;
  return { account: a.id as string, profile: p.id as string, inspiration: i.id as string, key, attachment };
}
const drain = (deleteObjects: (keys: string[]) => Promise<string[]>, at = now) => drainAttachmentObjects(t.db as never, { storageScope: scope, now: at, deleteObjects });

it('commits cleanup inventory across a profile cascade and retries transport failure in a new worker call', async () => {
  const f = await fixture();
  await t.sql`DELETE FROM profiles WHERE id=${f.profile}`;
  expect((await drain(async () => { throw new Error('transport'); })).failed).toBeGreaterThan(0);
  const [pending] = await t.sql`SELECT * FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  expect(pending.key).toBe(f.key); expect(pending.closed_at).not.toBeNull(); expect(pending.attempts).toBe(1);
  const removed: string[] = [];
  await drain(async keys => { removed.push(...keys); return []; }, new Date(now.getTime()+120_000));
  expect(removed).toContain(f.key);
  const [done] = await t.sql`SELECT * FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  expect(done.key).toBeNull(); expect(done.completed_at).not.toBeNull(); expect(done.issued_profile_id).toBeNull();
});

it('does not create committed cleanup from a rolled back source deletion', async () => {
  const f = await fixture();
  await expect(t.sql.begin(async tx => { await tx`DELETE FROM attachments WHERE id=${f.attachment.id}`; throw new Error('rollback'); })).rejects.toThrow('rollback');
  const [row] = await t.sql`SELECT due_at FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  expect(row.due_at).toBeNull();
});

it('keeps bytes named by a retained copy, then records cleanup when that copy expires', async () => {
  const f = await fixture();
  await t.sql`INSERT INTO deleted_inspirations(id,profile_id,text,source,visibility,attachments,kept_at,deleted_at) VALUES(${randomUUID()},${f.profile},'copy','app','private',${JSON.stringify([{s3Key:f.key}])}::jsonb,'2019-01-01','2020-01-01')`;
  await t.sql`DELETE FROM attachments WHERE id=${f.attachment.id}`;
  const seen: string[] = []; await drain(async keys => { seen.push(...keys); return []; }); expect(seen).not.toContain(f.key);
  await sweepDeletedShelf(t.db as never, now, f.profile, async () => {});
  await drain(async keys => { seen.push(...keys); return []; }); expect(seen).toContain(f.key);
});

it('inventories stale staged uploads before their rows disappear', async () => {
  const f = await fixture(); const conversation = randomUUID(), message = randomUUID(), key = f.key+'-stage';
  await t.sql`INSERT INTO conversations(id,profile_id) VALUES(${conversation},${f.profile})`;
  await t.sql`INSERT INTO attachments(profile_id,conversation_id,staged_message_id,type,url,s3_key,created_at) VALUES(${f.profile},${conversation},${message},'image','https://synthetic.invalid/staged',${key},'2020-01-01')`;
  await t.sql`UPDATE attachment_objects SET storage_scope=${scope} WHERE key_hash=${attachmentKeyHash(key)}`;
  await sweepStaleStagedAttachments(t.db as never, now, async () => {});
  const seen: string[] = []; await drain(async keys => { seen.push(...keys); return []; }); expect(seen).toContain(key);
});

it('retains per-key failure while settling successful keys', async () => {
  const a = await fixture(), b = await fixture();
  await t.sql`DELETE FROM attachments WHERE id IN (${a.attachment.id},${b.attachment.id})`;
  await drain(async keys => keys.filter(key => key === a.key));
  const rows = await t.sql`SELECT key_hash,key,completed_at FROM attachment_objects WHERE key_hash IN (${attachmentKeyHash(a.key)},${attachmentKeyHash(b.key)})`;
  expect(rows.find(r=>r.key_hash===attachmentKeyHash(a.key))!.key).toBe(a.key);
  expect(rows.find(r=>r.key_hash===attachmentKeyHash(b.key))!.completed_at).not.toBeNull();
});

it.each([null,'another-store'])('never sends unbound/different-store inventory (%s) to the configured store', async binding => {
  const f = await fixture(); await t.sql`DELETE FROM attachments WHERE id=${f.attachment.id}`;
  await t.sql`UPDATE attachment_objects SET storage_scope=${binding} WHERE key_hash=${attachmentKeyHash(f.key)}`;
  const seen: string[] = []; await drain(async keys => { seen.push(...keys); return []; }); expect(seen).not.toContain(f.key);
  const [row] = await t.sql`SELECT key,last_error,closed_at FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  expect(row.key).toBe(f.key); expect(row.last_error).toBe('storage_scope_unverified'); expect(row.closed_at).toBeNull();
});

it('fences a finalize whose HEAD succeeded before concurrent cleanup', async () => {
  const f = await fixture(); await t.sql`DELETE FROM attachments WHERE id=${f.attachment.id}`;
  const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, connection: { search_path: t.schemaName } });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(r=>{enter=r;}), proceed = new Promise<void>(r=>{release=r;});
  const cleaning = drainAttachmentObjects(t.db as never, { keys:[f.key], storageScope:scope, now, deleteObjects:async()=>{enter();await proceed;return [];} });
  try {
    await entered;
    let settled = false;
    const finalizing = other`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key) VALUES(${f.profile},${f.inspiration},'image','https://synthetic.invalid/stale-head',${f.key})`.then(()=>{settled=true;return 'accepted';},()=>{settled=true;return 'refused';});
    expect(await finalizing).toBe('refused'); expect(settled).toBe(true);
    release(); await cleaning;
    expect(await t.sql`SELECT id FROM attachments WHERE s3_key=${f.key}`).toHaveLength(0);
  } finally { release(); await other.end(); }
});

it('preserves fail-closed account erasure on object transport failure', async () => {
  const f = await fixture();
  await expect(eraseAccount(f.account, { db:t.db as never, deleteAttachmentObjects:async()=>{throw new Error('bucket unavailable');} })).rejects.toThrow('bucket unavailable');
  expect(await t.sql`SELECT id FROM accounts WHERE id=${f.account}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM attachments WHERE id=${f.attachment.id}`).toHaveLength(1);
});

it('preserves fresh issuance grace across duplicate/out-of-order completion events', async () => {
  const f=await fixture(), key=f.key+'-issued', expiresAt=new Date(now.getTime()+300_000);
  expect(await recordAttachmentUpload(t.db as never,{key,profileId:f.profile,expiresAt,now,storageScope:scope})).toBe(true);
  for(const at of [new Date(now.getTime()+1000),now,new Date(now.getTime()+2000)]) expect(await recordAttachmentObjectCreated(t.db as never,key,scope,at)).toBe(true);
  const seen:string[]=[];await drain(async keys=>{seen.push(...keys);return [];},new Date(now.getTime()+UPLOAD_FINALIZATION_GRACE_MS-1));expect(seen).not.toContain(key);
  await drain(async keys=>{seen.push(...keys);return [];},new Date(now.getTime()+UPLOAD_FINALIZATION_GRACE_MS));expect(seen).toContain(key);
});

it('removes a PUT completed after expiry AND a successful earlier absent-object cleanup', async () => {
  const f=await fixture(),key=f.key+'-late';
  await recordAttachmentUpload(t.db as never,{key,profileId:f.profile,expiresAt:new Date(now.getTime()+300_000),now,storageScope:scope});
  await t.sql`DELETE FROM accounts WHERE id=${f.account}`;
  const objects=new Set<string>();
  const remove=async(keys:string[])=>{for(const key of keys)objects.delete(key);return [];};
  await drain(remove);
  // Request began before expiry; completion happens two days after the first
  // successful (absent-object) DELETE. URL expiry did not cancel that request.
  objects.add(key);const later=new Date(now.getTime()+2*UPLOAD_FINALIZATION_GRACE_MS);
  expect(await recordAttachmentObjectCreated(t.db as never,key,scope,later)).toBe(true);
  await drain(remove,later);expect(objects.has(key)).toBe(false);
  await recordAttachmentObjectCreated(t.db as never,key,scope,later);await drain(remove,later);expect(objects.size).toBe(0);
  const [row]=await t.sql`SELECT key,issued_profile_id,closed_at FROM attachment_objects WHERE key_hash=${attachmentKeyHash(key)}`;
  expect(row.key).toBeNull();expect(row.issued_profile_id).toBeNull();expect(row.closed_at).not.toBeNull();
});

it('keeps a finalized issuance live, and fences a later erased upload with a friendly refusal', async()=>{
  const f=await fixture(),key=f.key+'-finalized';
  await recordAttachmentUpload(t.db as never,{key,profileId:f.profile,expiresAt:new Date(now.getTime()+300_000),now,storageScope:scope});
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key) VALUES(${f.profile},${f.inspiration},'image','https://synthetic.invalid/finalized',${key})`;
  const seen:string[]=[];await drain(async keys=>{seen.push(...keys);return [];},new Date(now.getTime()+UPLOAD_FINALIZATION_GRACE_MS));expect(seen).not.toContain(key);
  await t.sql`DELETE FROM attachments WHERE s3_key=${key}`;
  await drain(async keys=>{seen.push(...keys);return [];});expect(seen).toContain(key);
  await expect(t.db.transaction(tx=>assertAttachmentKeysUnused(tx,[key]))).rejects.toMatchObject({status:409,code:'attachment_erased'});
});

it('refuses issuance for a removed owner and ignores unknown/wrong-store events', async()=>{
  const f=await fixture(),key=f.key+'-unknown';
  expect(await recordAttachmentObjectCreated(t.db as never,key,scope,now)).toBe(false);
  expect(await recordAttachmentObjectCreated(t.db as never,f.key,'different-store',now)).toBe(false);
  await t.sql`DELETE FROM accounts WHERE id=${f.account}`;
  expect(await recordAttachmentUpload(t.db as never,{key,profileId:f.profile,expiresAt:now,now,storageScope:scope})).toBe(false);
  expect(await t.sql`SELECT key_hash FROM attachment_objects WHERE key_hash=${attachmentKeyHash(key)}`).toHaveLength(0);
});

it('commits presign inventory before returning a URL and returns 409 for a closed finalize', async()=>{
  const f=await fixture();
  vi.stubEnv('ATTACHMENTS_BUCKET','synthetic');vi.stubEnv('ATTACHMENTS_REGION','us-west-2');vi.stubEnv('ATTACHMENTS_ENDPOINT','http://127.0.0.1:1');
  const routes=createAttachmentRoutes({getDatabase:()=>t.db as never,attachmentHead:async()=>({ContentLength:8,ContentType:'image/png'}),authMiddleware:async(c,next)=>{
    c.set('session',{sessionId:randomUUID(),account:{id:f.account,email:'synthetic@example.test'},profile:{id:f.profile,accountId:f.account,type:'human',name:'Synthetic',preferredLocale:'en-US'}});await next();
  }});
  const issued=await routes.request('/presign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:'synthetic.png',contentType:'image/png',size:8})});
  expect(issued.status).toBe(200);const data=await issued.json() as {key:string;uploadUrl:string};
  const [inventory]=await t.sql`SELECT * FROM attachment_objects WHERE key_hash=${attachmentKeyHash(data.key)}`;
  expect(inventory.issued_profile_id).toBe(f.profile);expect(inventory.storage_scope).toBe(scope);expect(inventory.upload_expires_at).not.toBeNull();expect(data.uploadUrl).toContain('X-Amz-Signature');
  const conversation=randomUUID();await t.sql`INSERT INTO conversations(id,profile_id) VALUES(${conversation},${f.profile})`;
  await t.sql`DELETE FROM attachments WHERE id=${f.attachment.id}`;await drain(async()=>[]);
  const closed=await routes.request('/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:conversation,messageId:randomUUID(),type:'image',key:f.key,contentType:'image/png',size:8})});
  expect(closed.status).toBe(409);expect(await closed.json()).toMatchObject({code:'attachment_erased'});
});

it.each(['before-delete','after-delete','settlement-rollback'] as const)('retains a committed closure across crash window %s',async fault=>{
  const f=await fixture();await t.sql`DELETE FROM attachments WHERE id=${f.attachment.id}`;
  const objects=new Set([f.key]);
  const claim=await prepareAttachmentObjectCleanup(t.db as never,{keys:[f.key],storageScope:scope,now});
  expect(claim.deleting).toHaveLength(1);
  if(fault!=='before-delete')objects.delete(f.key); // Physical DELETE already succeeded.
  if(fault==='settlement-rollback')await expect(t.db.transaction(async tx=>{
    await settleAttachmentObjectCleanup(tx,claim.deleting,[],now);throw Error('commit failed');
  })).rejects.toThrow('commit failed');
  const [pending]=await t.sql`SELECT closed_at,key,completed_at FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  expect(pending.closed_at).not.toBeNull();expect(pending.key).toBe(f.key);expect(pending.completed_at).toBeNull();
  // A stale successful HEAD cannot insert a missing-object reference after
  // rollback/restart; closure belongs to a separately committed transaction.
  await expect(t.db.transaction(tx=>assertAttachmentKeysUnused(tx,[f.key]))).rejects.toMatchObject({status:409});
  await drainAttachmentObjects(t.db as never,{keys:[f.key],storageScope:scope,now:new Date(now.getTime()+ATTACHMENT_CLEANUP_CLAIM_MS),deleteObjects:async keys=>{keys.forEach(key=>objects.delete(key));return [];}});
  expect(objects.size).toBe(0);
  expect((await t.sql`SELECT key FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`)[0].key).toBeNull();
});

it('does not clobber a same-timestamp completion delivered during DELETE, on pool one',async()=>{
  const f=await fixture();await t.sql`DELETE FROM attachments WHERE id=${f.attachment.id}`;
  const [before]=await t.sql`SELECT generation::text FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  const result=await drainAttachmentObjects(t.db as never,{keys:[f.key],storageScope:scope,now,deleteObjects:async()=>{
    // This obtains the SAME single DB connection while external I/O is active.
    await recordAttachmentObjectCreated(t.db as never,f.key,scope,now);return [];
  }});
  expect(result.deleted).toBe(0);
  const [pending]=await t.sql`SELECT key,generation::text,closed_at,due_at FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`;
  expect(pending.key).toBe(f.key);expect(BigInt(pending.generation)).toBe(BigInt(before.generation)+1n);expect(pending.closed_at).not.toBeNull();
  expect(new Date(pending.due_at).getTime()).toBe(now.getTime());
  await drainAttachmentObjects(t.db as never,{keys:[f.key],storageScope:scope,now,deleteObjects:async()=>[]});
  expect((await t.sql`SELECT key FROM attachment_objects WHERE key_hash=${attachmentKeyHash(f.key)}`)[0].key).toBeNull();
});
