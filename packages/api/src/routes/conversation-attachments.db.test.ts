/** WHAT THIS MOCKS, AND WHY (gate G6): `authMiddleware` supplies fixture
 * sessions (human, agent, keeper key), `attachmentHead` stands in for S3's
 * HEAD, `deleteAttachmentObjects` records swept keys instead of calling S3,
 * and `ModelProvider` returns a fixed reply so the model input can be read.
 * Real routes, zod, transactions, composite FKs, CHECKs and cascades run on
 * disposable Postgres. No network. */
import {randomUUID} from 'node:crypto';
import {Hono} from 'hono';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {createConversationRoutes} from './conversations.js';
import {createAttachmentRoutes} from './attachments.js';
import type {AuthEnv} from '../lib/middleware.js';
import {attachmentNote,attachmentSearchText,sweepStaleStagedAttachments} from '../lib/conversation-attachments.js';
import {getDb} from '../lib/db.js';
import {setDefaultModelProviderForTests,type ConversationReplyInput,type ConversationReplyResult,type ModelProvider} from '../lib/model-provider.js';
import {postgresBackgroundJobStore,processBackgroundJob} from '../lib/queue.js';

let t:TestDatabase;
const connection=process.env.DB_CONNECTION_URL!;
const swept:string[][]=[];
const answer=vi.fn<(input:ConversationReplyInput)=>Promise<ConversationReplyResult>>(async()=>({answer:'That looks like a useful page to keep.',followUpQuestion:null,citations:[]}));
beforeAll(async()=>{t=await createTestDatabase();const url=new URL(connection);url.searchParams.set('options',`-c search_path=${t.schemaName}`);process.env.DB_CONNECTION_URL=url.toString();});
beforeEach(async()=>{await t.truncateAll();swept.length=0;answer.mockClear();
  vi.stubEnv('ATTACHMENTS_BUCKET','chat-fixture');vi.stubEnv('ATTACHMENTS_ENDPOINT','http://127.0.0.1:8792');vi.stubEnv('WAKA_CONVERSATION_REPLIES','1');
  setDefaultModelProviderForTests({name:'chat-attachment-fixture',answerConversation:answer} as unknown as ModelProvider);});
afterAll(async()=>{setDefaultModelProviderForTests(null);await getDb().$client.end();vi.unstubAllEnvs();await t?.cleanup();process.env.DB_CONNECTION_URL=connection;});

type Kind='human'|'agent'|'key';
async function person(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${randomUUID()+'@example.test'}) RETURNING id`;
  const [human]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'human','Person') RETURNING id`;
  const [agent]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'agent','Agent') RETURNING id`;
  const heads=new Map<string,{ContentLength:number;ContentType:string}>();
  const app=(kind:Kind='human')=>{
    const profileId=kind==='agent'?agent.id:human.id;
    const auth=async(c:any,next:()=>Promise<void>)=>{c.set('session',{sessionId:randomUUID(),...(kind==='key'?{keyScoped:true as const}:{}),account:{id:account.id,email:'p@example.test'},
      profile:{id:profileId,accountId:account.id,type:kind==='agent'?'agent':'human',name:'Fixture',preferredLocale:'en-US'}});await next();};
    const hono=new Hono<AuthEnv>();
    hono.route('/conversations',createConversationRoutes({getDatabase:()=>t.db as never,authMiddleware:auth as never,deleteAttachmentObjects:async keys=>{swept.push(keys);}}));
    hono.route('/attachments',createAttachmentRoutes({getDatabase:()=>t.db as never,authMiddleware:auth as never,deleteAttachmentObjects:async keys=>{swept.push(keys);},
      attachmentHead:async(_bucket,key)=>{const head=heads.get(key);if(!head)throw Object.assign(new Error('missing'),{name:'NotFound'});return head;}}));
    return hono;
  };
  const human_=app('human');
  const post=(path:string,body:unknown,via=human_)=>via.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  /** An object "PUT" under this person's prefix, as S3 would report it. */
  const upload=(contentType='image/png',size=120,uploader:string=human.id)=>{const key=`profiles/${uploader}/attachments/${Date.now()}-${randomUUID().slice(0,8)}.bin`;heads.set(key,{ContentLength:size,ContentType:contentType});return {key,contentType,size};};
  const stage=async(conversationId:string,messageId:string,options:{type?:'image'|'file';contentType?:string;name?:string;via?:Hono<AuthEnv>}={})=>{
    const object=upload(options.contentType??(options.type==='file'?'application/pdf':'image/png'));
    return post('/attachments',{conversationId,messageId,type:options.type??'image',...object,name:options.name??'photo.png'},options.via);
  };
  return {app,human:human_,post,upload,stage,heads,profileId:human.id as string,agentId:agent.id as string,accountId:account.id as string};
}
const json=async(response:Response)=>await response.json() as any;

it('stages a photo for a first message, sends it with no words, and reads it back on the message',async()=>{
  const p=await person(),conversationId=randomUUID(),messageId=randomUUID();
  const staged=await p.stage(conversationId,messageId,{name:'IMG_2041.png'});
  expect(staged.status).toBe(201);
  const attachment=(await json(staged)).attachment;
  expect(attachment).toMatchObject({conversationId,messageId,staged:true,type:'image',name:'IMG_2041.png',contentType:'image/png',size:120});
  expect(attachment).not.toHaveProperty('url');
  const created=await p.post('/conversations',{id:conversationId,firstMessage:{id:messageId,content:'   ',attachmentIds:[attachment.id]}});
  expect(created.status).toBe(200);
  const message=(await json(created)).conversation.messages[0];
  expect(message.content).toBe('');
  expect(message.attachments).toEqual([{...attachment,staged:false}]);
  const read=await json(await p.human.request(`/conversations/${conversationId}`));
  expect(read.conversation.messages[0].attachments.map((row:any)=>row.id)).toEqual([attachment.id]);
  expect((await json(await p.human.request('/conversations'))).conversations[0].preview).toBe('');
  const [row]=await t.sql`SELECT inspiration_id,conversation_id,message_id,staged_message_id,enrichment_status FROM attachments WHERE id=${attachment.id}`;
  expect(row).toMatchObject({inspiration_id:null,conversation_id:conversationId,message_id:messageId,staged_message_id:null,enrichment_status:'unavailable'});
  expect(await t.sql`SELECT id FROM background_jobs WHERE type::text='enrich_attachment'`).toHaveLength(0);
  // Same create replayed joins; a replay naming different attachments is a different create.
  expect((await p.post('/conversations',{id:conversationId,firstMessage:{id:messageId,content:'',attachmentIds:[attachment.id]}})).status).toBe(200);
  expect((await p.post('/conversations',{id:conversationId,firstMessage:{id:messageId,content:'',attachmentIds:[randomUUID()]}})).status).toBe(409);
});

it('a message needs words or an attachment, on create and on send',async()=>{
  const p=await person(),conversationId=randomUUID();
  expect((await p.post('/conversations',{id:conversationId,firstMessage:{id:randomUUID(),content:''}})).status).toBe(400);
  expect((await p.post('/conversations',{id:conversationId})).status).toBe(200);
  expect((await p.post(`/conversations/${conversationId}/messages`,{id:randomUUID(),content:'  ',revision:0})).status).toBe(400);
  expect((await p.post(`/conversations/${conversationId}/messages`,{id:randomUUID(),content:'',revision:0,attachmentIds:[]})).status).toBe(400);
  // The CHECK still refuses whitespace and an empty assistant message.
  await expect(t.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content) VALUES(${randomUUID()},${p.profileId},${conversationId},1,'user',' ')`).rejects.toThrow();
  await expect(t.sql`INSERT INTO conversation_messages(id,profile_id,conversation_id,position,role,content) VALUES(${randomUUID()},${p.profileId},${conversationId},1,'assistant','')`).rejects.toThrow();
  const messageId=randomUUID(),file=await json(await p.stage(conversationId,messageId,{type:'file',name:'plan.pdf'}));
  const sent=await p.post(`/conversations/${conversationId}/messages`,{id:messageId,content:'Here is the plan.',revision:0,attachmentIds:[file.attachment.id]});
  expect(sent.status).toBe(200);
  expect((await json(sent)).conversation.messages[0]).toMatchObject({content:'Here is the plan.',attachments:[{id:file.attachment.id,type:'file',contentType:'application/pdf'}]});
  // Exact replay is idempotent; the same id with other attachments is refused.
  expect((await p.post(`/conversations/${conversationId}/messages`,{id:messageId,content:'Here is the plan.',revision:0,attachmentIds:[file.attachment.id]})).status).toBe(200);
  expect((await p.post(`/conversations/${conversationId}/messages`,{id:messageId,content:'Here is the plan.',revision:0})).status).toBe(409);
});

it("refuses another profile's chat, another message's attachments, a sent message and agent sessions",async()=>{
  const owner=await person(),stranger=await person(),conversationId=randomUUID();
  await owner.post('/conversations',{id:conversationId});
  // Another account cannot stage onto this chat, nor name it via ?profile=.
  expect((await stranger.stage(conversationId,randomUUID())).status).toBe(404);
  expect((await stranger.post(`/attachments?profile=${owner.profileId}`,{conversationId,messageId:randomUUID(),type:'image',...stranger.upload(),name:'x.png'})).status).toBe(404);
  // Agent sessions and keeper keys cannot attach to a chat at all.
  for(const kind of ['agent','key'] as const)expect((await owner.stage(conversationId,randomUUID(),{via:owner.app(kind)})).status).toBe(403);
  // An attachment staged for message A cannot be sent with message B, and the refused send leaves nothing behind.
  const a=randomUUID(),b=randomUUID(),forA=await json(await owner.stage(conversationId,a));
  expect((await owner.post(`/conversations/${conversationId}/messages`,{id:b,content:'Look',revision:0,attachmentIds:[forA.attachment.id]})).status).toBe(409);
  expect(await t.sql`SELECT id FROM conversation_messages WHERE id=${b}`).toHaveLength(0);
  // A stranger cannot send someone else's staged attachment in their own chat either.
  const theirs=randomUUID();await stranger.post('/conversations',{id:theirs});
  expect((await stranger.post(`/conversations/${theirs}/messages`,{id:a,content:'Mine now',revision:0,attachmentIds:[forA.attachment.id]})).status).toBe(409);
  // Once a message is sent it takes no more attachments.
  await owner.post(`/conversations/${conversationId}/messages`,{id:a,content:'Look',revision:0,attachmentIds:[forA.attachment.id]});
  expect((await owner.stage(conversationId,a)).status).toBe(409);
  // A message id belongs to one conversation.
  const elsewhere=randomUUID(),c=randomUUID();await owner.stage(conversationId,c);
  expect((await owner.stage(elsewhere,c)).status).toBe(409);
  // The composite FK makes a cross-profile link impossible even by hand.
  const [row]=await t.sql`SELECT id FROM attachments WHERE staged_message_id=${c}`;
  await expect(t.sql`UPDATE attachments SET message_id=${a},staged_message_id=NULL,profile_id=${stranger.profileId} WHERE id=${row.id}`).rejects.toThrow();
});

it('checks the upload itself: owner prefix, HEAD agreement, allowed types, one object per row and the bounds',async()=>{
  const p=await person(),other=await person(),conversationId=randomUUID(),messageId=randomUUID();
  const body=(object:{key:string;contentType:string;size:number},type:'image'|'file'='image')=>({conversationId,messageId,type,...object});
  expect((await p.post('/attachments',body(p.upload('image/png',120,other.profileId)))).status).toBe(403);
  const lying=p.upload('image/png',120);p.heads.set(lying.key,{ContentLength:999,ContentType:'image/png'});
  expect((await p.post('/attachments',body(lying))).status).toBe(400);
  const gone=p.upload();p.heads.delete(gone.key);expect((await p.post('/attachments',body(gone))).status).toBe(404);
  expect((await p.post('/attachments',body(p.upload('application/zip'),'file'))).status).toBe(400);
  expect((await p.post('/attachments',body(p.upload('application/pdf'),'image'))).status).toBe(400);
  expect((await p.post('/attachments',{...body(p.upload()),inspirationId:randomUUID()})).status).toBe(400);
  const once=p.upload();expect((await p.post('/attachments',body(once))).status).toBe(201);
  expect((await p.post('/attachments',{...body(once),messageId:randomUUID()})).status).toBe(409);
  for(const type of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/markdown','text/csv'])
    expect((await p.post('/attachments',body(p.upload(type),'file'))).status).toBe(201);
  for(let i=0;i<2;i++)expect((await p.post('/attachments',body(p.upload()))).status).toBe(201);
  expect((await p.post('/attachments',body(p.upload()))).status).toBe(409);
  expect(await t.sql`SELECT id FROM attachments WHERE staged_message_id=${messageId}`).toHaveLength(6);
});

it('opens chat bytes for the person only, and deleting the chat takes linked and staged rows and sweeps their objects',async()=>{
  const p=await person(),conversationId=randomUUID(),sentId=randomUUID(),draftId=randomUUID();
  const sent=await json(await p.stage(conversationId,sentId));
  const dropped=await json(await p.stage(conversationId,sentId));
  await p.post('/conversations',{id:conversationId,firstMessage:{id:sentId,content:'Photo',attachmentIds:[sent.attachment.id]}});
  // A chip removed after upload is deleted with the send, and its object swept.
  expect(await t.sql`SELECT id FROM attachments WHERE id=${dropped.attachment.id}`).toHaveLength(0);
  expect(swept.flat()).toHaveLength(1);
  const draft=await json(await p.stage(conversationId,draftId,{type:'file'}));
  const opened=await p.human.request(`/attachments/${sent.attachment.id}/url`);
  expect(opened.status).toBe(200);expect(new URL((await json(opened)).url).pathname).toContain('/chat-fixture/profiles/');
  expect((await p.app('agent').request(`/attachments/${sent.attachment.id}/url`)).status).toBe(404);
  expect((await p.human.request(`/attachments/${sent.attachment.id}/details`)).status).toBe(404);
  const keys=(await t.sql`SELECT s3_key FROM attachments WHERE conversation_id=${conversationId}`).map(row=>row.s3_key).sort();
  expect(keys).toHaveLength(2);swept.length=0;
  expect((await p.human.request(`/conversations/${conversationId}`,{method:'DELETE'})).status).toBe(200);
  expect(await t.sql`SELECT id FROM attachments WHERE id IN (${sent.attachment.id},${draft.attachment.id})`).toHaveLength(0);
  expect(swept.flat().sort()).toEqual(keys);
  expect((await p.human.request(`/attachments/${sent.attachment.id}/url`)).status).toBe(404);
  // Staging onto the deleted chat is refused.
  expect((await p.stage(conversationId,randomUUID())).status).toBe(410);
});

it('tells the reply model what was attached, by kind and name',async()=>{
  const p=await person(),conversationId=randomUUID(),messageId=randomUUID();
  const photo=await json(await p.stage(conversationId,messageId,{name:'kitchen\nsketch.png'}));
  const file=await json(await p.stage(conversationId,messageId,{type:'file',name:'lease "draft".pdf'}));
  expect((await p.post('/conversations',{id:conversationId,firstMessage:{id:messageId,content:'',requestReply:true,attachmentIds:[photo.attachment.id,file.attachment.id]}})).status).toBe(200);
  await t.sql`UPDATE background_jobs SET run_after=now()+interval '1 day' WHERE type::text<>'generate_conversation_reply'`;
  const job=await postgresBackgroundJobStore.claimNext(new Date());expect(job?.type).toBe('generate_conversation_reply');
  await processBackgroundJob(job!);
  const input=answer.mock.calls.at(-1)![0];
  expect(input.history.at(-1)).toEqual({role:'user',content:`[Attached, not read: photo "kitchen sketch.png", file "lease 'draft'.pdf"]`});
  expect(attachmentNote([])).toBe('');
});

it('a file in a note still goes through the inspiration finalize path unchanged',async()=>{
  const p=await person();
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.profileId},'A note with a file') RETURNING id`;
  const object=p.upload('application/pdf',300);
  const response=await p.post('/attachments',{inspirationId:source.id,type:'file',...object,name:'notes.pdf'});
  expect(response.status).toBe(201);
  expect((await json(response)).attachment).toMatchObject({inspirationId:source.id,type:'file',name:'notes.pdf',enrichment:{status:'unavailable'}});
  const [row]=await t.sql`SELECT conversation_id,message_id,staged_message_id FROM attachments WHERE inspiration_id=${source.id}`;
  expect(row).toEqual({conversation_id:null,message_id:null,staged_message_id:null});
  // The owner CHECK refuses a row with two owners or none.
  await expect(t.sql`INSERT INTO attachments(profile_id,inspiration_id,conversation_id,staged_message_id,type,url,s3_key) VALUES(${p.profileId},${source.id},${randomUUID()},${randomUUID()},'image','u','k')`).rejects.toThrow();
  await expect(t.sql`INSERT INTO attachments(profile_id,type,url) VALUES(${p.profileId},'link','https://example.test')`).rejects.toThrow();
});

it('a chat photo is a raster photo: SVG is refused as a photo and as a file',async()=>{
  const p=await person(),conversationId=randomUUID(),messageId=randomUUID();
  for(const type of ['image','file'] as const)
    expect((await p.stage(conversationId,messageId,{type,contentType:'image/svg+xml',name:'logo.svg'})).status).toBe(400);
  expect((await p.stage(conversationId,messageId,{contentType:'image/bmp'})).status).toBe(400);
  for(const contentType of ['image/jpeg','image/webp','image/heic'])
    expect((await p.stage(conversationId,messageId,{contentType})).status).toBe(201);
  expect(await t.sql`SELECT id FROM attachments WHERE content_type='image/svg+xml'`).toHaveLength(0);
});

it('the staged cap counts only the last day: an abandoned draft does not hold the composer shut',async()=>{
  const p=await person(),conversationId=randomUUID();
  for(let i=0;i<5;i++)for(let j=0;j<6;j++)expect((await p.stage(conversationId,`00000000-0000-4000-8000-00000000000${i}`)).status).toBe(201);
  expect((await p.stage(conversationId,randomUUID())).status).toBe(429);
  await t.sql`UPDATE attachments SET created_at=now()-interval '25 hours' WHERE staged_message_id IS NOT NULL`;
  expect((await p.stage(conversationId,randomUUID())).status).toBe(201);
  // The per-message bound still counts every staged row for that message, whatever its age.
  expect((await p.stage(conversationId,'00000000-0000-4000-8000-000000000000')).status).toBe(409);
});

it('DELETE /attachments/:id discards a staged chat upload: the owner only, never a sent one',async()=>{
  const p=await person(),stranger=await person(),conversationId=randomUUID(),draftId=randomUUID();
  const draft=(await json(await p.stage(conversationId,draftId))).attachment;
  const del=(id:string,via=p.human)=>via.request(`/attachments/${id}`,{method:'DELETE'});
  // Agent sessions and keeper keys cannot; another account sees nothing; a bad id is 400.
  for(const kind of ['agent','key'] as const)expect((await del(draft.id,p.app(kind))).status).toBe(403);
  expect((await del(draft.id,stranger.human)).status).toBe(404);
  expect((await stranger.human.request(`/attachments/${draft.id}?profile=${p.profileId}`,{method:'DELETE'})).status).toBe(404);
  expect((await del('not-a-uuid')).status).toBe(400);
  expect(await t.sql`SELECT id FROM attachments WHERE id=${draft.id}`).toHaveLength(1);
  // The owner's discard works for a chat that was never created, and sweeps the object.
  const [{s3_key:key}]=await t.sql`SELECT s3_key FROM attachments WHERE id=${draft.id}`;swept.length=0;
  const gone=await del(draft.id);
  expect(gone.status).toBe(200);expect(await json(gone)).toEqual({deleted:true,id:draft.id});
  expect(await t.sql`SELECT id FROM attachments WHERE id=${draft.id}`).toHaveLength(0);
  expect(swept).toEqual([[key]]);
  expect((await del(draft.id)).status).toBe(404);
  // A sent message's attachment is 409; an inspiration's attachment is not a chat's (404).
  const sentId=randomUUID(),sent=(await json(await p.stage(conversationId,sentId))).attachment;
  await p.post('/conversations',{id:conversationId,firstMessage:{id:sentId,content:'Look',attachmentIds:[sent.id]}});
  expect((await del(sent.id)).status).toBe(409);
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.profileId},'A note') RETURNING id`;
  const [note]=await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url) VALUES(${p.profileId},${source.id},'link','https://example.test') RETURNING id`;
  expect((await del(note.id)).status).toBe(404);
  expect(await t.sql`SELECT id FROM attachments WHERE id IN (${sent.id},${note.id})`).toHaveLength(2);
});

it('the daily sweep removes staged uploads past their week, rows and bytes, and nothing else',async()=>{
  const p=await person(),other=await person(),conversationId=randomUUID(),oldDraft=randomUUID(),freshDraft=randomUUID(),sentId=randomUUID();
  const old=(await json(await p.stage(conversationId,oldDraft))).attachment;
  const theirs=(await json(await other.stage(randomUUID(),randomUUID()))).attachment;
  const fresh=(await json(await p.stage(conversationId,freshDraft))).attachment;
  const sent=(await json(await p.stage(conversationId,sentId))).attachment;
  await p.post('/conversations',{id:conversationId,firstMessage:{id:sentId,content:'Sent',attachmentIds:[sent.id]}});
  await t.sql`UPDATE attachments SET created_at=now()-interval '8 days' WHERE id IN (${old.id},${theirs.id},${sent.id})`;
  // A legacy row on the same object as an abandoned upload keeps its bytes.
  const [{s3_key:oldKey}]=await t.sql`SELECT s3_key FROM attachments WHERE id=${old.id}`;
  const [{s3_key:theirKey}]=await t.sql`SELECT s3_key FROM attachments WHERE id=${theirs.id}`;
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${other.profileId},'Legacy') RETURNING id`;
  await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key) VALUES(${other.profileId},${source.id},'image','u',${theirKey})`;
  const removed:string[][]=[];
  expect(await sweepStaleStagedAttachments(t.db as never,new Date(),async keys=>{removed.push(keys);})).toBe(2);
  expect((await t.sql`SELECT id FROM attachments WHERE conversation_id IS NOT NULL`).map(row=>row.id).sort()).toEqual([fresh.id,sent.id].sort());
  expect(removed.flat()).toEqual([oldKey]);
  // Nothing left to sweep: a second run is a no-op.
  expect(await sweepStaleStagedAttachments(t.db as never,new Date(),async keys=>{removed.push(keys);})).toBe(0);
});

it('the inspiration finalize keeps one stored object to one attachment, like capture and the chat finalize',async()=>{
  const p=await person();
  const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.profileId},'A note with a file') RETURNING id`;
  const object=p.upload('application/pdf',300);
  expect((await p.post('/attachments',{inspirationId:source.id,type:'file',...object})).status).toBe(201);
  const again=await p.post('/attachments',{inspirationId:source.id,type:'file',...object});
  expect(again.status).toBe(409);expect(await json(again)).toMatchObject({code:'attachment_already_attached'});
  // Nor can a note take an object a chat message already carries.
  const staged=(await json(await p.stage(randomUUID(),randomUUID()))).attachment;
  const [{s3_key:chatKey}]=await t.sql`SELECT s3_key FROM attachments WHERE id=${staged.id}`;
  const stolen=await p.post('/attachments',{inspirationId:source.id,type:'image',key:chatKey,contentType:'image/png',size:120});
  expect(stolen.status).toBe(409);
  expect(await t.sql`SELECT id FROM attachments WHERE s3_key=${chatKey}`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM attachments WHERE inspiration_id=${source.id}`).toHaveLength(1);
});

it('a photo-only message still reads saved material: the latest words, else what was attached',async()=>{
  const p=await person(),conversationId=randomUUID();
  await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${p.profileId},'Kitchen remodel: open shelves, warm oak, one long counter.')`;
  const replyTo=async()=>{
    await t.sql`UPDATE background_jobs SET run_after=now()+interval '1 day' WHERE type::text<>'generate_conversation_reply'`;
    const job=await postgresBackgroundJobStore.claimNext(new Date());expect(job?.type).toBe('generate_conversation_reply');
    await processBackgroundJob(job!);return answer.mock.calls.at(-1)![0];
  };
  // No words anywhere: the attachment's name is the search.
  const first=randomUUID(),photo=(await json(await p.stage(conversationId,first,{name:'kitchen_remodel.png'}))).attachment;
  expect((await p.post('/conversations',{id:conversationId,firstMessage:{id:first,content:'',requestReply:true,attachmentIds:[photo.id]}})).status).toBe(200);
  expect((await replyTo()).sources.map(source=>source.text)).toEqual([expect.stringContaining('open shelves')]);
  expect(attachmentSearchText([{name:'kitchen_remodel.png'},{name:null}])).toBe('kitchen remodel');
  // Words earlier in the chat: the photo-only turn searches with them.
  const conversation2=randomUUID(),words=randomUUID();
  expect((await p.post('/conversations',{id:conversation2,firstMessage:{id:words,content:'What about the oak counter?'}})).status).toBe(200);
  const second=randomUUID(),photo2=(await json(await p.stage(conversation2,second,{name:'IMG_2041.png'}))).attachment;
  expect((await p.post(`/conversations/${conversation2}/messages`,{id:second,content:'',revision:1,requestReply:true,attachmentIds:[photo2.id]})).status).toBe(200);
  expect((await replyTo()).sources.map(source=>source.text)).toEqual([expect.stringContaining('warm oak')]);
});
