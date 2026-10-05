/** WHAT THIS MOCKS, AND WHY: nothing. The pre-optimization scoring expression
 * is a SQL oracle over the same real fixture; production formatting/current
 * revision checks run for both ordered selections. No provider calls. */
import {and,asc,desc,eq,or,sql} from 'drizzle-orm';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {attachments,inspirations,inspirationRevisions,reflections} from '../db/index.js';
import {effectiveAttachmentStatus,effectiveAttachmentText} from './attachment-material.js';
import {conversationSearchTerms,readConversationMaterial} from './conversation-material.js';
let t:TestDatabase,profileId:string;
beforeAll(async()=>{
  t=await createTestDatabase();
  for(const [n,email] of ['own','foreign'].entries()){
    const [a]=await t.sql`INSERT INTO accounts(email) VALUES (${`material-equivalence-${email}@example.test`}) RETURNING id`;
    const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human',${email}) RETURNING id`;
    if(n===0)profileId=p.id;
    for(let i=0;i<14;i++){
      const text=i%3===0?'quiet woodland tools literal%_! '.repeat(i===12?120:1):i%3===1?'여백은 쉼을 위한 공간이다.': 'A different moment';
      const [s]=await t.sql`INSERT INTO inspirations(profile_id,text,created_at)
        VALUES (${p.id},${text},'2026-10-01T12:00:00.000Z') RETURNING id`;
      if(i%2===0)await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer,skipped)
        VALUES (${p.id},${s.id},'Why?','quiet tools 쉼',false),(${p.id},${s.id},'Again?','quiet tools 쉼',false),
          (${p.id},${s.id},'Skip?','SKIPPED_ONLY',true)`;
      if(i%4===0)await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text)
        VALUES (${p.id},${s.id},'link','https://example.test/fixture','ready','page_body','woodland observation tools'),
          (${p.id},${s.id},'image','https://storage.test/fixture','pending','image_description','PENDING_ONLY')`;
      if(i===5)await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
        VALUES (${p.id},${s.id},'audio','https://storage.test/audio','failed','audio_transcription','Superseded speech','pottery 쉼')`;
      if(i===13)await t.sql`DELETE FROM inspiration_revisions WHERE profile_id=${p.id} AND inspiration_id=${s.id}`;
    }
    await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${p.id},'İstanbul Straße ΣΙΓΜΑ σίγμα ÉCOLE café 커피')`;
  }
});
afterAll(async()=>{await t.cleanup();});
async function legacyIds(terms:string[]){
  if(!terms.length)return [];
  const matches=terms.map(term=>{
    const likeQuery=`%${term.replace(/[!%_]/g,c=>'!'+c)}%`;
    return or(sql`${inspirations.text} ILIKE ${likeQuery} ESCAPE '!'`,
      sql`EXISTS(SELECT 1 FROM ${reflections} WHERE ${reflections.profileId}=${inspirations.profileId}
        AND ${reflections.inspirationId}=${inspirations.id} AND NOT ${reflections.skipped} AND ${reflections.answer} ILIKE ${likeQuery} ESCAPE '!')`,
      sql`EXISTS(SELECT 1 FROM ${attachments} WHERE ${attachments.profileId}=${inspirations.profileId}
        AND ${attachments.inspirationId}=${inspirations.id} AND ${effectiveAttachmentStatus}='ready' AND ${effectiveAttachmentText} ILIKE ${likeQuery} ESCAPE '!')`)!;
  });
  const score=sql`(${sql.join(matches.map(match=>sql`CASE WHEN ${match} THEN 1 ELSE 0 END`),sql` + `)})`;
  const rows=await t.db.select({id:inspirations.id}).from(inspirations).innerJoin(inspirationRevisions,
    and(eq(inspirationRevisions.profileId,inspirations.profileId),eq(inspirationRevisions.inspirationId,inspirations.id)))
    .where(and(eq(inspirations.profileId,profileId),or(...matches)))
    .orderBy(desc(score),desc(inspirations.createdAt),asc(inspirations.id)).limit(6);
  return rows.map(row=>row.id);
}
it.each(['quiet','tools woodland','quiet tools woodland','worl','쉼','여백 쉼','pottery','Superseded','SKIPPED_ONLY','PENDING_ONLY','notfoundzx','how can you','İstanbul','Straße','ΣΙΓΜΑ','σίγμα','ÉCOLE','커피'])
  ('preserves complete material, ordering, hashes and excerpts for %s',async query=>{
    const terms=conversationSearchTerms(query),ids=await legacyIds(terms);
    const actual=await readConversationMaterial(t.db as never,profileId,terms);
    expect(actual.map(row=>row.id)).toEqual(ids);
    expect(actual).toEqual(await readConversationMaterial(t.db as never,profileId,[],ids));
  });
it('counts a matched term once across duplicate witnesses, but preserves repeated explicit term positions',async()=>{
  for(const terms of [['quiet','tools'],['quiet','quiet'],['%','_','!']]){
    const ids=await legacyIds(terms),actual=await readConversationMaterial(t.db as never,profileId,terms);
    expect(actual).toEqual(await readConversationMaterial(t.db as never,profileId,[],ids));
  }
});
it('retains explicit reference order and the six-source limit without lexical re-ranking',async()=>{
  const ids=await legacyIds(['quiet','tools']);const reversed=[...ids].reverse();
  expect((await readConversationMaterial(t.db as never,profileId,['pottery'],reversed)).map(row=>row.id)).toEqual(reversed);
});
