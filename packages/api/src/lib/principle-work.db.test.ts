/** WHAT THIS MOCKS, AND WHY (gate G6): the model operation is a counter.
 * Real SQL verifies checkpoints, locks, tenant scope and dispatch accounting. */
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import postgres from 'postgres';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {principleWork} from './principle-work.js';
import {readGenerationRevision} from './generation-revision.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
let t:TestDatabase,n=0;
beforeAll(async()=>{t=await createTestDatabase();});afterAll(async()=>{await t.cleanup();});
async function fixture(){
  const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${`principle-step-${++n}@example.test`}) RETURNING id`;
  const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Fixture') RETURNING id`;
  await t.sql`INSERT INTO generation_revisions(profile_id) VALUES(${p.id}) ON CONFLICT DO NOTHING`;
  const revision=(await readGenerationRevision(t.db as never,{profileId:p.id}))!;
  return {db:t.db as never,profileId:p.id as string,billingProfileId:p.id as string,inputHash:'fixture',revision};
}
const validate=(value:unknown)=>{expect(value).toEqual({ok:true});return {ok:true};};
it('resumes completed steps without repaying them and caps each pass at four calls',async()=>{
  const options=await fixture(),operation=vi.fn(async()=>({ok:true})),first=principleWork(options);
  for(let i=0;i<4;i++)await first.run(String(i),operation,validate);
  await expect(first.run('4',operation,validate)).rejects.toBeInstanceOf(BackgroundJobHeldError);
  expect(operation).toHaveBeenCalledTimes(4);
  const second=principleWork(options);
  for(let i=0;i<5;i++)await second.run(String(i),operation,validate);
  expect(operation).toHaveBeenCalledTimes(5);
});
it('calls the model outside both profile and generation locks',async()=>{
  const options=await fixture(),url=new URL(process.env.DB_CONNECTION_URL!);url.searchParams.set('options',`-c search_path=${t.schemaName}`);
  const peer=postgres(url.toString(),{max:1,prepare:false,onnotice:()=>{}});
  try{await principleWork(options).run('one',async()=>{
    await peer`SELECT id FROM profiles WHERE id=${options.profileId} FOR UPDATE NOWAIT`;
    await peer`SELECT profile_id FROM generation_revisions WHERE profile_id=${options.profileId} FOR UPDATE NOWAIT`;
    return {ok:true};
  },validate);}finally{await peer.end();}
});
it('retains failed dispatch receipts while retrying only the unfinished operation',async()=>{
  const options=await fixture(),good=vi.fn(async()=>({ok:true}));
  await principleWork(options).run('done',good,validate);
  await expect(principleWork(options).run('retry',async()=>{throw new Error('Synthetic failure');},validate)).rejects.toThrow('Synthetic failure');
  await principleWork(options).run('done',good,validate);await principleWork(options).run('retry',good,validate);
  expect(good).toHaveBeenCalledTimes(2);
  expect(await t.sql`SELECT id FROM principle_generation_steps WHERE profile_id=${options.profileId}`).toHaveLength(3);
});
it('does not reset the hourly budget on a new pass or empty old response bodies',async()=>{
  const options=await fixture(),operation=vi.fn(async()=>({ok:true}));
  await t.sql`INSERT INTO principle_generation_steps(profile_id,billing_profile_id,input_hash,step_key,kind,status,finished_at)
    SELECT ${options.profileId},${options.profileId},'old',n::text,'model','ready',now() FROM generate_series(1,40) n`;
  await expect(principleWork(options).run('next',operation,validate)).rejects.toBeInstanceOf(BackgroundJobHeldError);
  expect(operation).not.toHaveBeenCalled();
});
it('cannot borrow another account for billing and does not reuse another profile cache',async()=>{
  const a=await fixture(),b=await fixture(),operation=vi.fn(async()=>({ok:true}));
  await principleWork(a).run('shared-name',operation,validate);
  await principleWork(b).run('shared-name',operation,validate);expect(operation).toHaveBeenCalledTimes(2);
  await expect(principleWork({...a,billingProfileId:b.profileId,inputHash:'new'}).run('wrong',operation,validate)).rejects.toThrow('billing scope');
  await t.sql`DELETE FROM profiles WHERE id=${a.profileId}`;
  expect(await t.sql`SELECT id FROM principle_generation_steps WHERE profile_id=${a.profileId}`).toHaveLength(0);
});
