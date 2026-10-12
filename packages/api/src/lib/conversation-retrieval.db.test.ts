/** WHAT THIS MOCKS, AND WHY (gate G6): document/query vectors are synthetic.
 * Real canonical indexing, SQL ownership, stale-input checks and context
 * selection run. This verifies plumbing, not semantic model quality. */
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {ensureInspirationEmbedding,GEMINI_EMBEDDING_MODEL} from './inspiration-embeddings.js';
import {readSemanticConversationCandidates} from './conversation-retrieval.js';
import {readConversationContext} from './conversation-context.js';
let t:TestDatabase,n=0;
const vector=(axis=0)=>Array.from({length:768},(_,i)=>i===axis?1:0);
beforeAll(async()=>{t=await createTestDatabase();});afterAll(async()=>{await t.cleanup();});
async function person(){
  const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${`semantic-${++n}@example.test`}) RETURNING id`;
  const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Fixture') RETURNING id`;
  return p.id as string;
}
async function indexed(profileId:string,text:string,axis=0,inputScope:'personal'|'public'='personal'){
  const [i]=await t.sql`INSERT INTO inspirations(profile_id,text,visibility) VALUES(${profileId},${text},'public') RETURNING id`;
  await ensureInspirationEmbedding({db:t.db as never,profileId,inspirationId:i.id,inputScope,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector(axis)}});
  return i.id as string;
}
it('adds a semantic-only owned match but excludes stale, foreign and public-scope vectors',async()=>{
  const profileId=await person(),foreign=await person();
  const relevant=await indexed(profileId,'Quiet mornings give my mind room to wander.');
  const stale=await indexed(profileId,'A former idea.');
  await indexed(profileId,'Unrelated cooking note.',1);
  await indexed(profileId,'Public-only vector.',0,'public');
  await indexed(foreign,'FOREIGN_PRIVATE_SENTINEL');
  const [oldIndex]=await t.sql`SELECT input_hash,embedding FROM inspiration_embeddings WHERE inspiration_id=${stale}`;
  await t.sql`UPDATE inspirations SET text='Changed after indexing.' WHERE id=${stale}`;
  // Normal edits delete the index. Reintroduce an explicitly stale cache row
  // to exercise the independent reader-side hash check as well.
  await t.sql`INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding)
    VALUES(${profileId},${stale},${GEMINI_EMBEDDING_MODEL},'personal',768,${oldIndex.input_hash},${JSON.stringify(oldIndex.embedding)}::jsonb)`;
  const result=await readSemanticConversationCandidates(t.db as never,profileId,vector());
  expect(result.candidates.map(row=>row.id)).toEqual([relevant]);expect(result.trace.rejected).toBe(1);
  expect((await readConversationContext(t.db as never,profileId,'unstructured rest')).inspirations).toHaveLength(0);
  const hybrid=await readConversationContext(t.db as never,profileId,'unstructured rest',undefined,undefined,undefined,vector());
  expect(hybrid.inspirations.map(row=>row.id)).toEqual([relevant]);expect(JSON.stringify(hybrid)).not.toContain('FOREIGN_PRIVATE_SENTINEL');
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES(${profileId},${relevant},'Why?','My view has changed.')`;
  const changed=await readSemanticConversationCandidates(t.db as never,profileId,vector());
  expect(changed.candidates.map(row=>row.id),JSON.stringify({relevant,stale,trace:changed.trace})).toEqual([]);
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,content_type,size,enrichment_status,enrichment_kind,enrichment_text)
    VALUES(${profileId},${relevant},'image','https://example.test/quiet.png','image/png',100,'ready','image_description','An open landscape.')`;
  await ensureInspirationEmbedding({db:t.db as never,profileId,inspirationId:relevant,client:{model:GEMINI_EMBEDDING_MODEL,embed:async()=>vector()}});
  expect((await readSemanticConversationCandidates(t.db as never,profileId,vector())).candidates.map(row=>row.id)).toEqual([relevant]);
});
it('bounds vector scanning and reports that it did not inspect the whole archive',async()=>{
  const profileId=await person();
  await t.sql`WITH notes AS (INSERT INTO inspirations(profile_id,text) SELECT ${profileId},'Unrelated source' FROM generate_series(1,501) RETURNING id)
    INSERT INTO inspiration_embeddings(profile_id,inspiration_id,model,input_scope,dimensions,input_hash,embedding)
    SELECT ${profileId},id,${GEMINI_EMBEDDING_MODEL},'personal',768,'synthetic',${JSON.stringify(vector(1))}::jsonb FROM notes`;
  const result=await readSemanticConversationCandidates(t.db as never,profileId,vector());
  expect(result.trace).toMatchObject({scanned:500,scanLimited:true,validated:0});expect(result.candidates).toHaveLength(0);
});
it('fails closed on oversized canonical material without removing lexical access',async()=>{
  const profileId=await person();
  const id=await indexed(profileId,'woodland '.repeat(2000));
  expect((await readSemanticConversationCandidates(t.db as never,profileId,vector())).candidates).toHaveLength(0);
  expect((await readConversationContext(t.db as never,profileId,'woodland')).inspirations[0]?.id).toBe(id);
});
