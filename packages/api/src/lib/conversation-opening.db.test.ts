/** Real owned/current-source readers and SQL. No model, bucket or external HTTP. */
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {conversationHash} from './conversation-context.js';
import {prepareConversationOpening,projectConversationOpening,resolveConversationOpening} from './conversation-opening.js';
let t:TestDatabase;
beforeAll(async()=>{t=await createTestDatabase();});beforeEach(async()=>{await t.truncateAll();});afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Synthetic opening') RETURNING id`;
  const [artifact]=await t.sql`INSERT INTO top_of_minds(profile_id,version,status) VALUES(${profile.id},1,'live') RETURNING id`;
  const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at) VALUES(${artifact.id},'pattern','A current locked reading.',now()) RETURNING id`;
  return {profileId:profile.id as string,entryId:entry.id as string};
}
async function inspiration(profileId:string,text:string){return (await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profileId},${text}) RETURNING id`)[0].id as string;}
async function support(profileId:string,entryId:string,inspirationId:string){
  const [signal]=await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES(${profileId},'A current supported signal.','emerging') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id,statement_revision,material_revision) SELECT ${profileId},${profileId},${signal.id},${inspirationId},1,personal_revision FROM inspiration_revisions WHERE inspiration_id=${inspirationId}`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision,entry_body_revision) VALUES(${entryId},${signal.id},1,1)`;
}
it('binds the displayed Why order to current owned edges and preserves derived photo-only cards',async()=>{
  const f=await fixture(),other=await fixture(),first=await inspiration(f.profileId,'First saved words.'),photo=await inspiration(f.profileId,''),foreign=await inspiration(other.profileId,'Foreign words');
  const [attachment]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,name) VALUES(${f.profileId},${photo},'image','synthetic-photo','synthetic/photo','photo.png') RETURNING id`;
  await support(f.profileId,f.entryId,first);await support(f.profileId,f.entryId,photo);
  const selection={locale:'en-US' as const,text:'A current locked reading.',source:{kind:'top_of_mind_entry' as const,id:f.entryId,why:true,supportIds:[photo,first]}};
  const binding=await prepareConversationOpening(t.db as never,f.profileId,selection);expect(binding?.kind).toBe('source');
  const view=await projectConversationOpening(t.db as never,f.profileId,binding);
  expect(view).toMatchObject({available:true,provenance:'application',sources:[{id:photo,photoId:attachment.id,wordless:true},{id:first,preview:'First saved words.'}]});
  expect(await prepareConversationOpening(t.db as never,f.profileId,{...selection,source:{...selection.source,supportIds:[foreign]}})).toBeNull();
  const imageOpening=await prepareConversationOpening(t.db as never,f.profileId,{locale:'en-US',text:'',source:{kind:'inspiration',id:photo}});
  expect(await projectConversationOpening(t.db as never,f.profileId,imageOpening)).toMatchObject({available:true,quote:'',photoId:attachment.id,wordless:true});
  await t.sql`UPDATE inspirations SET text='Changed original words' WHERE id=${first}`;
  expect(await projectConversationOpening(t.db as never,f.profileId,binding)).toMatchObject({available:false});
});
it('refuses recomputed public hashes with invalid semantic source selectors or invented Why edges',async()=>{
  const f=await fixture(),id=await inspiration(f.profileId,'Owned but unrelated.');
  const binding=await prepareConversationOpening(t.db as never,f.profileId,{locale:'en-US',text:'Owned but unrelated.',source:{kind:'inspiration',id}});expect(binding?.kind).toBe('source');if(binding?.kind!=='source')throw Error('fixture');
  const forge=(patch:Record<string,unknown>)=>{const value={...binding,...patch};return {...value,hash:conversationHash([value.source,value.why,value.supports,value.question??null,value.imageId??null])};};
  for(const value of [forge({why:true}),forge({supports:[binding.source]}),forge({supports:[binding.source],why:true})])expect(await resolveConversationOpening(t.db as never,f.profileId,value)).toMatchObject({available:false});
  const reading=await prepareConversationOpening(t.db as never,f.profileId,{locale:'en-US',text:'A current locked reading.',source:{kind:'top_of_mind_entry',id:f.entryId}});if(reading?.kind!=='source')throw Error('fixture');
  const invalid={...reading,question:'worldInspirationReviewQuestion' as const};invalid.hash=conversationHash([invalid.source,false,[],invalid.question,null]);
  expect(await resolveConversationOpening(t.db as never,f.profileId,invalid)).toMatchObject({available:false});
});
it('does not combine a previously valid proof with newer display words between READ COMMITTED statements',async()=>{
  const f=await fixture(),binding=await prepareConversationOpening(t.db as never,f.profileId,{locale:'en-US',text:'A current locked reading.',source:{kind:'top_of_mind_entry',id:f.entryId}});
  let reads=0;
  const wrap=(builder:any):any=>new Proxy(builder,{get(target,key){if(key==='then')return (ok:any,bad:any)=>Promise.resolve(target).then(async rows=>{if(++reads===1)await t.sql`UPDATE top_of_mind_entries SET body='NEW WORDS must not appear under OLD proof' WHERE id=${f.entryId}`;return rows;}).then(ok,bad);const value=Reflect.get(target,key);return typeof value==='function'? (...args:any[])=>{const next=value.apply(target,args);return next&&typeof next==='object'?wrap(next):next;}:value;}});
  const db={select:(...args:any[])=>wrap((t.db.select as any)(...args)),execute:t.db.execute.bind(t.db)};
  const view=await projectConversationOpening(db as never,f.profileId,binding);
  expect(reads).toBeGreaterThan(1);expect(view).toMatchObject({available:false});expect(JSON.stringify(view)).not.toContain('NEW WORDS');
});
it('resolves current image words by owned attachment identity without storing them in the descriptor',async()=>{
  const f=await fixture(),other=await fixture(),id=await inspiration(f.profileId,'Caption'),foreign=await inspiration(other.profileId,'Foreign');
  const [photo]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,enrichment_status,enrichment_text) VALUES(${f.profileId},${id},'image','synthetic','synthetic/owned','ready','Words: A quoted line.\nImage: A synthetic page.') RETURNING id`;
  const [foreignPhoto]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,enrichment_status,enrichment_text) VALUES(${other.profileId},${foreign},'image','synthetic','synthetic/foreign','ready','Words: Foreign line.\nImage: A synthetic page.') RETURNING id`;
  const selection={locale:'en-US' as const,text:'Caption\n\n“A quoted line.”',source:{kind:'inspiration' as const,id,imageId:photo.id}};
  const binding=await prepareConversationOpening(t.db as never,f.profileId,selection);expect(binding).not.toBeNull();expect(JSON.stringify(binding)).not.toContain('quoted line');
  expect(await projectConversationOpening(t.db as never,f.profileId,binding)).toMatchObject({available:true,quote:selection.text,photoId:photo.id});
  expect(await prepareConversationOpening(t.db as never,f.profileId,{...selection,source:{...selection.source,imageId:foreignPhoto.id}})).toBeNull();
  await t.sql`UPDATE attachments SET transcript_correction='Corrected words',transcript_revision=transcript_revision+1 WHERE id=${photo.id}`;
  expect(await projectConversationOpening(t.db as never,f.profileId,binding)).toMatchObject({available:false});
});
