/** WHAT THIS MOCKS, AND WHY: `fetch` supplies the wire. The real client
 * builds the chat finalize request, verifies the attachments a message comes
 * back with, and decides which files "Add file" may send. */
import {afterEach,expect,it,vi} from 'vitest';
import {fetchConversation,saveConversationMessage} from '../src/lib/api/conversations';
import {finalizeAttachment,uploadMessageAttachment} from '../src/lib/api/attachments';
import {FILE_ACCEPT,FileRefused,MAX_MESSAGE_ATTACHMENTS,attachmentFileContentType,inspectAttachmentFile} from '../src/lib/api/file-accept';
afterEach(()=>vi.unstubAllGlobals());
const createdAt='2026-10-15T12:00:00Z';
const attachment={id:'a1',conversationId:'conversation',messageId:'m1',staged:false,type:'image',name:'IMG.png',contentType:'image/png',size:120,createdAt};
const row=(attachments:unknown[])=>({id:'conversation',profileId:'profile',revision:1,createdAt,updatedAt:createdAt,
  messages:[{id:'m1',profileId:'profile',conversationId:'conversation',position:1,role:'user',content:'',createdAt,attachments}]});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});

it('reads a photo-only message with its attachments',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({conversation:row([attachment]),generationEnabled:false})));
  const conversation=await fetchConversation('profile','conversation');
  expect(conversation.messages[0]).toMatchObject({content:'',attachments:[attachment]});
});
it.each([[{...attachment,messageId:'other'}],[{...attachment,conversationId:'other'}],[{...attachment,staged:true}],[{...attachment,type:'audio'}],Array.from({length:7},()=>attachment)])
('refuses attachments that are not this message\'s own %#',async(...items)=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({conversation:row(items),generationEnabled:false})));
  await expect(fetchConversation('profile','conversation')).rejects.toMatchObject({code:'invalid_conversation'});
});
it('sends attachmentIds with the message and stages onto the chat owner',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply({attachment:{...attachment,staged:true}},201)).mockResolvedValueOnce(reply({conversation:row([attachment]),generationEnabled:false}));
  vi.stubGlobal('fetch',fetch);
  const staged=await finalizeAttachment({conversationId:'conversation',messageId:'m1',type:'image',key:'k',contentType:'image/png',size:120},{profile:'profile'});
  expect(staged.staged).toBe(true);
  expect(fetch.mock.calls[0][0]).toBe('/api/attachments?profile=profile');
  await saveConversationMessage('profile','conversation',{id:'m1',content:'',revision:0,attachmentIds:[staged.id]});
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({id:'m1',content:'',revision:0,attachmentIds:['a1']});
});
it('refuses a finalize answer for a different message',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply({attachment:{...attachment,messageId:'m2',staged:true}},201)));
  await expect(finalizeAttachment({conversationId:'conversation',messageId:'m1',type:'image',key:'k',contentType:'image/png',size:120})).rejects.toMatchObject({code:'invalid_response'});
});
it('uploads in three steps with one content type throughout',async()=>{
  const fetch=vi.fn()
    .mockResolvedValueOnce(reply({profileId:'profile',uploadUrl:'https://bucket.example/put',key:'profiles/p/attachments/1.pdf',expiresAt:createdAt,headers:{'Content-Type':'application/pdf','Content-Length':'3'}}))
    .mockResolvedValueOnce(new Response(null,{status:200}))
    .mockResolvedValueOnce(reply({attachment:{...attachment,type:'file',name:'plan.pdf',contentType:'application/pdf',size:3,staged:true}},201));
  vi.stubGlobal('fetch',fetch);
  const file=new File(['pdf'],'plan.pdf',{type:''});
  const {contentType,kind}=inspectAttachmentFile(file);
  expect([contentType,kind]).toEqual(['application/pdf','file']);
  const result=await uploadMessageAttachment({profile:'profile',conversationId:'conversation',messageId:'m1',file,contentType,type:kind});
  expect(result.type).toBe('file');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({filename:'plan.pdf',contentType:'application/pdf',size:3});
  expect(fetch.mock.calls[1][1]).toMatchObject({method:'PUT',headers:{'Content-Type':'application/pdf','Content-Length':'3'}});
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({conversationId:'conversation',messageId:'m1',type:'file',key:'profiles/p/attachments/1.pdf',contentType:'application/pdf',size:3,name:'plan.pdf'});
});
const presigned=()=>reply({profileId:'profile',uploadUrl:'https://bucket.example/put',key:'profiles/p/attachments/1.png',expiresAt:createdAt,headers:{'Content-Type':'image/png','Content-Length':'3'}});
it('an abort calls the upload off only while it is presigning; from the PUT on it finishes',async()=>{
  // Called off during the presign: nothing was made, so nothing is sent.
  const early=new AbortController();
  const first=vi.fn().mockImplementationOnce(async()=>{early.abort();return presigned();});
  vi.stubGlobal('fetch',first);
  await expect(uploadMessageAttachment({profile:'profile',conversationId:'conversation',messageId:'m1',file:new File(['png'],'a.png',{type:'image/png'}),contentType:'image/png',type:'image'},early.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(first,'bytes were sent after the upload was called off').toHaveBeenCalledTimes(1);
  // Called off during the PUT: the object may land, so it lands and is staged — the caller discards it.
  const late=new AbortController();
  const fetch=vi.fn().mockResolvedValueOnce(presigned())
    .mockImplementationOnce(async()=>{late.abort();return new Response(null,{status:200});})
    .mockResolvedValueOnce(reply({attachment:{...attachment,staged:true}},201));
  vi.stubGlobal('fetch',fetch);
  const row=await uploadMessageAttachment({profile:'profile',conversationId:'conversation',messageId:'m1',file:new File(['png'],'a.png',{type:'image/png'}),contentType:'image/png',type:'image'},late.signal);
  expect(row.id).toBe('a1');
  expect(fetch.mock.calls[1][1].signal,'the PUT could be cut off mid-object').toBeUndefined();
  expect(fetch.mock.calls[2][1].signal,'the finalize could be cut off mid-commit').toBeUndefined();
});
it('sends no name for an unnamed upload',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(presigned()).mockResolvedValueOnce(new Response(null,{status:200}))
    .mockResolvedValueOnce(reply({attachment:{...attachment,name:null,staged:true}},201));
  vi.stubGlobal('fetch',fetch);
  await uploadMessageAttachment({profile:'profile',conversationId:'conversation',messageId:'m1',file:new File(['png'],'',{type:'image/png'}),contentType:'image/png',type:'image'});
  expect(JSON.parse(fetch.mock.calls[2][1].body)).not.toHaveProperty('name');
});
it('reads a refusal\'s missing ids up to a message\'s cap, and no further',async()=>{
  const refusal=(count:number)=>reply({error:'Some attachments are not ready.',code:'attachment_not_ready',missingAttachmentIds:Array.from({length:count},(_,at)=>`a${at}`)},409);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(refusal(MAX_MESSAGE_ATTACHMENTS)).mockResolvedValueOnce(refusal(MAX_MESSAGE_ATTACHMENTS+1)));
  const send=()=>saveConversationMessage('profile','conversation',{id:'m1',content:'',revision:0,attachmentIds:['a0']});
  await expect(send()).rejects.toMatchObject({code:'attachment_not_ready',missingAttachmentIds:Array.from({length:MAX_MESSAGE_ATTACHMENTS},(_,at)=>`a${at}`)});
  const tooMany=await send().catch(error=>error);
  expect(tooMany.code).toBe('attachment_not_ready');
  expect(tooMany.missingAttachmentIds,'a list longer than a message can carry was believed').toBeUndefined();
});
it('"Add file" offers documents and photos, and refuses what the server would',()=>{
  expect(FILE_ACCEPT).toContain('application/pdf');expect(FILE_ACCEPT).toContain('.docx');expect(FILE_ACCEPT).toContain('.md');
  expect(attachmentFileContentType({name:'notes.md',type:''})).toBe('text/markdown');
  expect(attachmentFileContentType({name:'sheet.csv',type:'application/vnd.ms-excel'})).toBe('application/vnd.ms-excel');
  expect(attachmentFileContentType({name:'virus.pdf',type:'application/x-msdownload'})).toBeNull();
  expect(attachmentFileContentType({name:'archive.zip',type:'application/zip'})).toBeNull();
  expect(()=>inspectAttachmentFile(new File([],'empty.pdf',{type:'application/pdf'}))).toThrow(FileRefused);
  expect(inspectAttachmentFile(new File(['x'],'photo.heic',{type:''})).kind).toBe('image');
});
