/** WHAT THIS MOCKS, AND WHY: nothing. Real context/reference readers use
 * disposable Postgres, owned human words, generated support and dated versions.
 * No model, deployed database or real account is involved. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {readConversationContext,currentConversationReferences,currentConversationReferenceGroups,conversationHash} from './conversation-context.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function owner(){const [a]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic history') RETURNING id`;return p.id as string;}
async function entry(profile:string,version:number,body:string,status:'live'|'superseded',reason='regenerated',locked=true){
  const [m]=await t.sql`INSERT INTO top_of_minds(profile_id,version,status,reason,created_at) VALUES(${profile},${version},${status},${reason},${`2026-09-${String(version).padStart(2,'0')}T12:00:00Z`}::timestamptz) RETURNING id`;
  const [e]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${m.id},'pattern',${body},${locked?'2026-09-01T00:00:00Z':null}::timestamptz) RETURNING id`;
  return e.id as string;
}
it('compares real owned records, skips audit copies and leaves ordinary context current-only',async()=>{
  const p=await owner(),other=await owner();
  const older=await entry(p,1,'I prefer a predictable routine.','superseded');
  await entry(p,2,'AUDIT_COPY_SENTINEL','superseded','no_change');
  const current=await entry(p,3,'I leave space for a small experiment.','live');
  await entry(other,1,'PRIVATE_FOREIGN_HISTORY','superseded');
  const normal=await readConversationContext(t.db as never,p,'A choice.');expect(normal.reading.map(row=>row.id)).toEqual([current]);
  const comparison=await readConversationContext(t.db as never,p,'What has changed in how I think?');
  expect(comparison.reading.map(row=>row.id)).toEqual([current,older]);
  expect(comparison.reading[1]).toMatchObject({historical:true,recordedAt:'2026-09-01T12:00:00.000Z',artifactVersion:1,supportCurrent:false});
  expect(JSON.stringify(comparison)).not.toMatch(/PRIVATE_FOREIGN_HISTORY|AUDIT_COPY_SENTINEL/);
});
it('does not turn unchanged words into a historical difference and bounds prior versions',async()=>{
  const p=await owner();for(let n=1;n<=8;n++)await entry(p,n,n===8?'Current words.':`Earlier words ${n}.`,'superseded');
  await entry(p,9,'Current words.','live');
  const context=await readConversationContext(t.db as never,p,'How has my thinking evolved?');
  expect(context.reading.filter(row=>row.historical).map(row=>row.artifactVersion)).toEqual([7,6]);
  expect(context.reading).toHaveLength(3);expect(context.reading.reduce((total,row)=>total+row.text.length,0)).toBeLessThanOrEqual(4000);
});
it('keeps reference identity across supersession, binds dates/words, and supports old text-only proof',async()=>{
  const p=await owner(),id=await entry(p,1,'The exact words I kept.','live');
  const source=(await readConversationContext(t.db as never,p,'A choice.')).reading[0];
  const reference={kind:'top_of_mind_entry' as const,id,hash:source.hash,quoteStart:0,quoteLength:10};
  await t.sql`UPDATE top_of_minds SET status='superseded' WHERE profile_id=${p}`;await entry(p,2,'New current words.','live');
  expect((await currentConversationReferences(t.db as never,p,[reference]))[0]).toMatchObject({historical:true,text:'The exact words I kept.'});
  const old=conversationHash({id:source.id,text:source.text,revision:source.revision,locked:source.locked,supportCurrent:source.supportCurrent});
  expect((await currentConversationReferences(t.db as never,p,[{...reference,hash:old}]))[0]?.id).toBe(id);
  await t.sql`UPDATE top_of_minds SET created_at=created_at+interval '1 hour' WHERE profile_id=${p} AND version=1`;
  expect((await currentConversationReferences(t.db as never,p,[reference]))[0]).toBeNull();
});
it('never admits unsupported machine history, dismissed words, or a foreign reference',async()=>{
  const p=await owner(),other=await owner();
  await entry(p,1,'UNSUPPORTED_MACHINE','superseded','regenerated',false);
  const dismissed=await entry(p,2,'DISMISSED_WORDS','superseded');await t.sql`UPDATE top_of_mind_entries SET dismissed_at=now() WHERE id=${dismissed}`;
  await entry(p,3,'Current kept words.','live');const foreign=await entry(other,1,'FOREIGN_WORDS','superseded');
  const context=await readConversationContext(t.db as never,p,'Compare my previous reading with now.');expect(JSON.stringify(context)).not.toMatch(/UNSUPPORTED_MACHINE|DISMISSED_WORDS|FOREIGN_WORDS/);
  expect(await currentConversationReferences(t.db as never,p,[{kind:'top_of_mind_entry',id:foreign,hash:'no-proof',quoteStart:0,quoteLength:10}])).toEqual([null]);
});
it('withdraws generated historical wording when its current witness disappears',async()=>{
  const p=await owner(),id=await entry(p,1,'Generated history with real current support.','superseded','regenerated',false);
  const [i]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p},'A saved choice.') RETURNING id`;
  const [s]=await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES(${p},'A saved choice.','emerging') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision) SELECT ${p},${p},${s.id},${i.id},1,personal_revision FROM inspiration_revisions WHERE inspiration_id=${i.id}`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision,entry_body_revision) VALUES(${id},${s.id},1,1)`;
  await entry(p,2,'Current kept words.','live');
  expect((await readConversationContext(t.db as never,p,'What changed in how I think?')).reading.some(row=>row.id===id)).toBe(true);
  await t.sql`DELETE FROM inspirations WHERE id=${i.id}`;
  expect((await readConversationContext(t.db as never,p,'What changed in how I think?')).reading.some(row=>row.id===id)).toBe(false);
});
it('batches mixed proofs without clipping large history, losing legacy text or admitting another profile',async()=>{
  const p=await owner(),other=await owner(),ids:string[]=[];
  for(let version=1;version<=6;version++)ids.push(await entry(p,version,`Kept reading ${version}. `+'x'.repeat(2000),'superseded'));
  const r=await readConversationContext(t.db as never,p,'',ids.map(id=>({kind:'top_of_mind_entry',id,hash:'setup'})));
  // Read individually so every offered excerpt has the original full allowance.
  const large=await Promise.all(ids.map(async id=>(await readConversationContext(t.db as never,p,'',[{kind:'top_of_mind_entry',id,hash:'setup'}])).reading[0]));
  expect(r.reading.length).toBe(5); // One broad context keeps its 8,000-char cap.
  expect(r.reading.reduce((sum,source)=>sum+source.text.length,0)).toBe(8000);
  const foreignId=await entry(other,1,'Other-profile words.','superseded');
  const foreign=(await readConversationContext(t.db as never,other,'',[{kind:'top_of_mind_entry',id:foreignId,hash:'setup'}])).reading[0];
  const [original]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p},'Original exact words.') RETURNING id`;
  const modern=(await readConversationContext(t.db as never,p,'Original exact words.')).inspirations[0];
  const [plain]=await t.sql`SELECT id,text,created_at::text AS "recordedAt",updated_at::text AS revision FROM inspirations WHERE id=${original.id}`;
  const reference=(source:typeof modern)=>({kind:source.kind,id:source.id,hash:source.hash,quoteStart:0,quoteLength:10,historical:source.historical});
  const groups=[...large.map(source=>[reference(source)]),[reference(modern),{...reference(modern),hash:conversationHash(plain)}],
    [reference(foreign),{...reference(large[0]),hash:'changed-proof'}]];
  const baseline=await Promise.all(groups.map(group=>currentConversationReferences(t.db as never,p,group)));
  const batched=await currentConversationReferenceGroups(t.db as never,p,groups);
  expect(batched).toEqual(baseline);expect(batched.slice(0,6).every(group=>group[0]?.text.length===1600)).toBe(true);
  expect(batched.at(-1)).toEqual([null,null]);expect(batched[6].every(source=>source?.id===original.id)).toBe(true);
  await t.sql`UPDATE inspirations SET text=text||' Edited.',updated_at=clock_timestamp() WHERE id=${original.id}`;
  await t.sql`UPDATE top_of_mind_entries SET body=body||' Changed outside its excerpt.' WHERE id=${ids[0]}`;
  const fresh=await currentConversationReferenceGroups(t.db as never,p,groups);
  expect(fresh[0]).toEqual([null]);expect(fresh[6]).toEqual([null,null]);
});
