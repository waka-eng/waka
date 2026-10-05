/** WHAT THIS MOCKS, AND WHY: nothing. Real migration, triggers, fallback and
 * bounded maintenance run on disposable Postgres. No model calls. */
import postgres from 'postgres';
import {afterAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {backfillInspirationTextSearch,currentInspirationTextSearchVector} from './inspiration-search.js';
import {sql} from 'drizzle-orm';
import {inspirations} from '../db/index.js';
import {loadInspirationMaterial} from './inspiration-material.js';
import {buildCanonicalInspirationEmbeddingInput} from './inspiration-embeddings.js';
let t:TestDatabase,sequence=0;
beforeEach(async()=>{t??=await createTestDatabase();await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
async function owner(){
  const [a]=await t.sql`INSERT INTO accounts(email) VALUES (${`search-vector-${++sequence}@example.test`}) RETURNING id`;
  const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human','Reader') RETURNING id`;
  return p.id as string;
}
async function source(profileId:string,text='garden walking'){
  const [row]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profileId},${text}) RETURNING id`;
  return row.id as string;
}
async function matches(profileId:string,query:string){
  const rows=await t.db.select({id:inspirations.id}).from(inspirations).where(sql`${inspirations.profileId}=${profileId} AND ${currentInspirationTextSearchVector} @@ plainto_tsquery('simple',${query})`);
  return rows.map(row=>row.id);
}
it('synchronizes text on insert and update, leaves children to current matching and removes storage with the source',async()=>{
  const profileId=await owner(),id=await source(profileId);
  expect(await matches(profileId,'walking garden')).toEqual([id]);
  const [first]=await t.sql`SELECT text_search_vector_policy AS policy FROM inspirations WHERE id=${id}`;expect(first.policy).toBe(1);
  await t.sql`UPDATE inspirations SET text='여백 생각' WHERE id=${id}`;
  expect(await matches(profileId,'walking')).toEqual([]);expect(await matches(profileId,'생각 여백')).toEqual([id]);
  const [before]=await t.sql`SELECT text_search_vector::text AS vector FROM inspirations WHERE id=${id}`;
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${profileId},${id},'Why?','A new reflection')`;
  const [after]=await t.sql`SELECT text_search_vector::text AS vector FROM inspirations WHERE id=${id}`;expect(after.vector).toBe(before.vector);
  await t.sql`DELETE FROM inspirations WHERE profile_id=${profileId} AND id=${id}`;
  expect(await matches(profileId,'여백')).toEqual([]);
});
it('falls back to current raw text for missing or unsupported projection coverage',async()=>{
  const profileId=await owner(),id=await source(profileId);
  await t.sql`UPDATE inspirations SET text_search_vector=NULL,text_search_vector_policy=NULL WHERE id=${id}`;
  expect(await matches(profileId,'walking garden')).toEqual([id]);
  await t.sql`UPDATE inspirations SET text_search_vector=to_tsvector('simple','obsolete'),text_search_vector_policy=99 WHERE id=${id}`;
  expect(await matches(profileId,'walking garden')).toEqual([id]);expect(await matches(profileId,'obsolete')).toEqual([]);
  expect(await backfillInspirationTextSearch(t.db as never,{profileId,limit:1})).toEqual({updated:1});
  expect(await matches(profileId,'walking garden')).toEqual([id]);
});
it('resumes bounded batches and never touches another profile during a scoped repair',async()=>{
  const own=await owner(),other=await owner();
  for(let n=0;n<5;n++)await source(own);
  await source(other);
  await t.sql`UPDATE inspirations SET text_search_vector=NULL,text_search_vector_policy=NULL`;
  expect(await backfillInspirationTextSearch(t.db as never,{profileId:own,limit:2})).toEqual({updated:2});
  expect(await backfillInspirationTextSearch(t.db as never,{profileId:own,limit:2})).toEqual({updated:2});
  expect(await backfillInspirationTextSearch(t.db as never,{profileId:own,limit:2})).toEqual({updated:1});
  expect(await backfillInspirationTextSearch(t.db as never,{profileId:own,limit:2})).toEqual({updated:0});
  const [foreign]=await t.sql`SELECT text_search_vector FROM inspirations WHERE profile_id=${other}`;expect(foreign.text_search_vector).toBeNull();
});
it('does not advance source/generation revisions, erase quotes or queue work during backfill',async()=>{
  const profileId=await owner(),id=await source(profileId);
  const [s]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profileId},'Leave room before committing') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,quote,quote_source,reason,statement_revision,material_revision)
    SELECT ${profileId},${profileId},${s.id},${id},'garden','own','Synthetic support',1,personal_revision FROM inspiration_revisions WHERE inspiration_id=${id}`;
  const versions=async()=>t.sql`SELECT r.personal_revision::text AS material,g.revision::text AS generation,e.quote,e.reason
    FROM inspiration_revisions r JOIN generation_revisions g ON g.profile_id=r.profile_id
    JOIN signal_evidence e ON e.owner_profile_id=r.profile_id AND e.inspiration_id=r.inspiration_id WHERE r.inspiration_id=${id}`;
  const before=await versions();
  const materialBefore=await loadInspirationMaterial(t.db as never,profileId,id,'personal');
  const inputBefore=buildCanonicalInspirationEmbeddingInput(materialBefore!.inspiration);
  await t.sql`UPDATE inspirations SET text_search_vector=NULL,text_search_vector_policy=NULL WHERE id=${id}`;
  expect(await backfillInspirationTextSearch(t.db as never,{limit:1})).toEqual({updated:1});
  expect(await versions()).toEqual(before);expect((await t.sql`SELECT id FROM background_jobs`)).toHaveLength(0);
  const materialAfter=await loadInspirationMaterial(t.db as never,profileId,id,'personal');
  expect(materialAfter!.identity).toEqual(materialBefore!.identity);
  expect(buildCanonicalInspirationEmbeddingInput(materialAfter!.inspiration)).toBe(inputBefore);
});
it('skips a busy original and never overwrites a concurrent text edit on resume',async()=>{
  const profileId=await owner(),id=await source(profileId);
  await t.sql`UPDATE inspirations SET text_search_vector=NULL,text_search_vector_policy=NULL WHERE id=${id}`;
  const url=new URL(process.env.DB_CONNECTION_URL!);url.searchParams.set('options',`-c search_path=${t.schemaName}`);
  const locker=postgres(url.toString(),{max:1,ssl:['127.0.0.1','localhost','::1'].includes(url.hostname)?false:'require'});
  let locked!:()=>void,release!:()=>void;
  const ready=new Promise<void>(done=>locked=done),wait=new Promise<void>(done=>release=done);
  const transaction=locker.begin(async tx=>{await tx`SELECT id FROM inspirations WHERE id=${id} FOR UPDATE`;locked();await wait;await tx`UPDATE inspirations SET text='A changed original' WHERE id=${id}`;});
  try{
    await ready;expect(await backfillInspirationTextSearch(t.db as never,{profileId,limit:1})).toEqual({updated:0});
    release();await transaction;expect(await matches(profileId,'changed original')).toEqual([id]);expect(await matches(profileId,'garden')).toEqual([]);
    expect(await backfillInspirationTextSearch(t.db as never,{profileId,limit:1})).toEqual({updated:0});
  }finally{release();await transaction;await locker.end();}
});
it('rejects unbounded batches and malformed owner scopes before SQL work',async()=>{
  for(const limit of [0,1001,Infinity])await expect(backfillInspirationTextSearch(t.db as never,{limit})).rejects.toThrow('batch');
  await expect(backfillInspirationTextSearch(t.db as never,{profileId:'not-an-owner'})).rejects.toThrow('profile');
});
