/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real SQL verifies owned
 * material retrieval and current-source checks; no models or network calls. */
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {conversationHash,currentConversationReferences,readConversationContext} from './conversation-context.js';
let t:TestDatabase,sequence=0;
beforeAll(async()=>{t=await createTestDatabase();});
afterAll(async()=>{await t.cleanup();});
async function owner(){
  const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${`chat-context-${++sequence}@example.test`}) RETURNING id`;
  const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Fixture') RETURNING id`;
  const [i]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.id},'A saved moment.') RETURNING id`;
  return {profileId:p.id as string,inspirationId:i.id as string};
}
it('finds a short Korean concept in an owned reflection and invalidates edited references',async()=>{
  const f=await owner(),foreign=await owner();
  const [answer]=await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
    VALUES(${f.profileId},${f.inspirationId},'What mattered?','쉼은 일을 멈추는 것 이상의 의미가 있다.') RETURNING id`;
  await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
    VALUES(${foreign.profileId},${foreign.inspirationId},'What mattered?','쉼 FOREIGN_PRIVATE_SENTINEL')`;
  const context=await readConversationContext(t.db as never,f.profileId,'쉼');
  expect(context.inspirations).toHaveLength(1);
  const source=context.inspirations[0]!;
  expect(source.text).toContain('쉼은');expect(JSON.stringify(context)).not.toContain('FOREIGN_PRIVATE_SENTINEL');
  expect((await currentConversationReferences(t.db as never,f.profileId,[source]))[0]).not.toBeNull();
  expect(await currentConversationReferences(t.db as never,foreign.profileId,[source])).toEqual([null]);
  await t.sql`UPDATE reflections SET answer='지금은 다른 의미로 생각한다.' WHERE id=${answer.id}`;
  expect(await currentConversationReferences(t.db as never,f.profileId,[source])).toEqual([null]);
});
it('uses a corrected transcript instead of the superseded machine transcript',async()=>{
  const f=await owner();
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,content_type,size,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
    VALUES(${f.profileId},${f.inspirationId},'audio','https://example.test/audio.webm','audio/webm',100,'ready','audio_transcription','I want marathon training.','I want pottery practice.')`;
  const context=await readConversationContext(t.db as never,f.profileId,'pottery');
  expect(context.inspirations).toHaveLength(1);
  expect(context.inspirations[0]!.text).toContain('I want pottery practice.');
  expect(context.inspirations[0]!.text).not.toContain('marathon');
  expect((await readConversationContext(t.db as never,f.profileId,'marathon')).inspirations).toHaveLength(0);
  const reference=context.inspirations[0]!;
  await t.sql`UPDATE attachments SET transcript_correction='I changed my view on this.' WHERE profile_id=${f.profileId}`;
  expect(await currentConversationReferences(t.db as never,f.profileId,[reference])).toEqual([null]);
});
it('preserves old plain-text citation hashes and offsets without upgrading their content',async()=>{
  const f=await owner();
  const [row]=await t.sql`SELECT id,text,created_at::text AS "recordedAt",updated_at::text AS revision FROM inspirations WHERE id=${f.inspirationId}`;
  const reference={kind:'inspiration' as const,id:f.inspirationId,hash:conversationHash(row),quoteStart:2,quoteLength:5};
  const [current]=await currentConversationReferences(t.db as never,f.profileId,[reference]);
  expect(current?.text).toBe('A saved moment.');expect(current?.hash).toBe(reference.hash);
  await t.sql`UPDATE inspirations SET text='Different words.' WHERE id=${f.inspirationId}`;
  expect(await currentConversationReferences(t.db as never,f.profileId,[reference])).toEqual([null]);
});
it('includes ready image and link material with provenance but excludes unavailable text',async()=>{
  const f=await owner();
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,content_type,size,enrichment_status,enrichment_kind,enrichment_text) VALUES
    (${f.profileId},${f.inspirationId},'image','https://example.test/picture.png','image/png',100,'ready','image_description','A quiet woodland landscape.'),
    (${f.profileId},${f.inspirationId},'link','https://example.test/article','text/html',100,'ready','page_body','A woodland walk can invite observation.'),
    (${f.profileId},${f.inspirationId},'image','https://example.test/failed.png','image/png',100,'failed','image_description','UNAVAILABLE_SENTINEL')`;
  const context=await readConversationContext(t.db as never,f.profileId,'woodland');
  expect(context.inspirations).toHaveLength(1);
  expect(context.inspirations[0]!.text).toContain('Image description (generated)');
  expect(context.inspirations[0]!.text).toContain('Link content');
  expect(JSON.stringify(context)).not.toContain('UNAVAILABLE_SENTINEL');
});
it('bounds per-source excerpts and total inspiration context even for long material',async()=>{
  const f=await owner();
  for(let n=0;n<8;n++)await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${f.profileId},${'woodland '.repeat(1000)})`;
  const context=await readConversationContext(t.db as never,f.profileId,'woodland');
  expect(context.inspirations.length).toBeGreaterThan(0);expect(context.inspirations.length).toBeLessThanOrEqual(6);
  expect(context.inspirations.reduce((sum,row)=>sum+row.text.length,0)).toBeLessThanOrEqual(4000);
  for(const source of context.inspirations){expect(source.text.length).toBeLessThanOrEqual(1600);expect(source.truncated).toBe(true);}
});
