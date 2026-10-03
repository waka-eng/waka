/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real local SQL, lifecycle,
 * signal detail and principle material reads must agree on raw witnesses.
 * Fixtures establish structural support, not a model-quality claim. */
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {refreshSignalLifecycle} from './signal-lifecycle.js';
import {loadPrincipleMaterial} from './principle-generation.js';
import {getProfileSignal} from '../routes/signals.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();});
beforeEach(async()=>{await t.truncateAll();});
afterAll(async()=>{await t?.cleanup();});
async function seed(count:number){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES ('independent-evidence@example.test') RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profile.id},'Synthetic corroborated statement') RETURNING id`;
  // Keep the live route's clock away from a .5 rounding boundary: 43 at
  // exactly zero age can become 42 a few milliseconds later without a bug.
  const createdAt=new Date(Date.now()-86400000).toISOString();
  const ids:string[]=[];
  for(let i=0;i<count;i++){
    const [source]=await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${profile.id},'A synthetic original observation',${createdAt}) RETURNING id`;ids.push(source.id);
    if(i===0){
      await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text)
        VALUES (${profile.id},${source.id},'audio','https://example.test/synthetic','ready','audio_transcription','The same observation in a transcript')`;
      await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer) VALUES (${profile.id},${source.id},'What stayed with you?','My thought about this same observation')`;
    }
    const [revision]=await t.sql`SELECT personal_revision FROM inspiration_revisions WHERE inspiration_id=${source.id}`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision)
      VALUES (${profile.id},${profile.id},${signal.id},${source.id},1,${revision.personal_revision})`;
  }
  await t.db.transaction(tx=>refreshSignalLifecycle(tx as never,signal.id,new Date()));
  return {profileId:profile.id as string,signalId:signal.id as string,ids};
}
it('counts a recording, transcript and its reflection as one source in the real read',async()=>{
  const f=await seed(1),detail=await getProfileSignal(t.db as never,{profileId:f.profileId,signalId:f.signalId});
  expect(detail).toMatchObject({status:'emerging',evidenceCount:1,confidence:24});
  const [row]=await t.sql`SELECT confidence,status FROM signals WHERE id=${f.signalId}`;expect(row).toMatchObject({confidence:24,status:'emerging'});
});
it('preserves promotion, serving counts and principle dates for three distinct originals',async()=>{
  const f=await seed(3),detail=await getProfileSignal(t.db as never,{profileId:f.profileId,signalId:f.signalId});
  expect(detail).toMatchObject({status:'active',evidenceCount:3,confidence:42});
  const material=await loadPrincipleMaterial(t.db as never,f.profileId);expect(material.evidence.get(f.signalId)?.evidenceAt).toHaveLength(3);
  await t.sql`DELETE FROM signal_evidence WHERE signal_id=${f.signalId} AND inspiration_id=${f.ids[2]}`;
  await t.db.transaction(tx=>refreshSignalLifecycle(tx as never,f.signalId,new Date()));
  expect(await getProfileSignal(t.db as never,{profileId:f.profileId,signalId:f.signalId})).toMatchObject({status:'active',evidenceCount:2,confidence:33});
  expect((await loadPrincipleMaterial(t.db as never,f.profileId)).evidence.get(f.signalId)?.evidenceAt).toHaveLength(2);
});
