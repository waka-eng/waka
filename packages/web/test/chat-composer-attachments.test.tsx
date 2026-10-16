// @vitest-environment jsdom
/**
 * ═══ A CHAT'S ＋: PHOTOS AND FILES ON THE WAY INTO A MESSAGE (2026-10-16) ═══
 *
 * Founder: "＋ menu rows: 'Add photos' and 'Add file'. On pick: validate …
 * then upload immediately … show them as CHIPS above the text field in the
 * box … each with an × … Send is enabled when there is text OR ≥1 uploaded
 * attachment (photo-only messages allowed); max 6."
 *
 * What is held here, in the order a person meets it: the ＋ is a menu of
 * those two rows; a picked photo is uploaded at once under THE ID THE MESSAGE
 * WILL BE SENT WITH (and, for a new chat, the id the create will use — the
 * server stages onto both); it shows as a chip and survives a reload; Send
 * names exactly the chips in `attachmentIds`, with or without words; × takes
 * one off; a failed upload says so on its chip and can be retried; a file the
 * server would refuse is refused before it is sent, in words; six is the most,
 * and the ＋ says why it dimmed. And when a page lends the panel a slot in its
 * bar, the mic and the ＋ go there and leave the box (`chat-bar.test.tsx`
 * holds the bar's shape on the real home page).
 *
 * How the transcript draws a sent message's attachments is
 * `MessageAttachments`' own business and its own suite's.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` returns
 * committed records the way `conversation-panel.test.tsx` does, and
 * `lib/api/attachments` stands in for the upload (`uploadMessageAttachment`,
 * one call: presign → PUT → stage) and for the short-lived read a restored
 * chip asks for (`fetchAttachmentUrl`). No server, bucket or account data is
 * used. The real panel, `AddMenu`, the real photo sniffer, the real
 * `inspectAttachmentFile` and the real draft storage run.
 */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {createConversation,fetchConversation,fetchConversationReply,listConversations,saveConversationMessage,type ApiConversation} from '../src/lib/api/conversations';
import {discardMessageAttachment,fetchAttachmentUrl,uploadMessageAttachment,type ApiMessageAttachment} from '../src/lib/api/attachments';
import {readConversationDrafts} from '../src/lib/conversation-drafts';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),listConversations:vi.fn(),saveConversationMessage:vi.fn()}));
vi.mock('../src/lib/api/attachments',async original=>({...await original<typeof import('../src/lib/api/attachments')>(),uploadMessageAttachment:vi.fn(),fetchAttachmentUrl:vi.fn(),discardMessageAttachment:vi.fn()}));

const scope={accountId:'owner',profileId:'profile'},chat='11111111-1111-4111-8111-111111111111',choose=vi.fn();
let root:Root,host:HTMLDivElement,stored:ApiConversation;
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  stored={id:chat,profileId:scope.profileId,revision:0,createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z',messages:[]};
  vi.mocked(fetchConversation).mockImplementation(async()=>structuredClone(stored));
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});
  vi.mocked(fetchConversationReply).mockResolvedValue({profileId:scope.profileId,conversationId:chat,messageId:null,requestId:null,phase:'idle',revision:0,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:false});
  const sent=(conversationId:string,input:{id:string;content:string;attachmentIds?:string[]})=>{
    stored={...stored,id:conversationId,revision:stored.revision+1,messages:[...stored.messages,{id:input.id,content:input.content,profileId:scope.profileId,conversationId,position:stored.revision+1,role:'user',createdAt:'2026-10-16T01:00:00Z',attachments:[]}]};
    return structuredClone(stored);
  };
  vi.mocked(saveConversationMessage).mockImplementation(async(_profile,conversationId,input)=>sent(conversationId,input));
  vi.mocked(createConversation).mockImplementation(async(_profile,conversationId,_signal,_principle,first)=>sent(conversationId,first!));
  vi.mocked(uploadMessageAttachment).mockImplementation(async(input)=>({id:crypto.randomUUID(),conversationId:input.conversationId,messageId:input.messageId,staged:true,
    type:input.type,name:input.name??null,contentType:input.contentType,size:input.file.size,createdAt:'2026-10-16T00:30:00Z'} satisfies ApiMessageAttachment));
  vi.mocked(fetchAttachmentUrl).mockResolvedValue('https://bucket.test/read');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.getElementById('lent-slot')?.remove();vi.restoreAllMocks();});

const mount=(id:string|null=chat,toolsSlot?:string)=>act(async()=>root.render(<ConversationPanel key={String(id)} scope={scope} id={id} locale="en-US" onChoose={choose} toolsSlot={toolsSlot}/>));
const flush=()=>act(async()=>{for(let turn=0;turn<6;turn+=1)await Promise.resolve();});
const plus=(within:ParentNode=host)=>within.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
const send=()=>host.querySelector<HTMLButtonElement>('button.chat-send')!;
const chips=()=>[...host.querySelectorAll<HTMLElement>('.chat-composer .chat-chip')];
const type=(content:string)=>act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,content);area.dispatchEvent(new Event('input',{bubbles:true}));});
/** A real PNG header, so the real sniffer has bytes to read. */
const png=(name='sky.png')=>new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82])],name,{type:'image/png'});
const pdf=(name='Lease.pdf')=>new File(['%PDF-1.7 the lease'],name,{type:'application/pdf'});
/** Hand the chooser behind a row some files, the way the operating system would. */
async function pick(row:'photos'|'file',files:File[]){
  const input=[...host.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(node=>row==='photos'?!node.accept.includes('application/pdf'):node.accept.includes('application/pdf'));
  if(!input)throw new Error(`no chooser for ${row}`);
  Object.defineProperty(input,'files',{configurable:true,value:files});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
  await flush();
}

it('offers the ＋ beside Send as a menu of Add photos and Add file', async()=>{
  await mount();await flush();
  expect(plus()?.getAttribute('aria-label')).toBe('Add photo or file');
  expect(plus()!.closest('footer.chat-composer'),'a panel standing alone lost its ＋').toBeTruthy();
  await act(async()=>plus()!.click());
  expect([...host.querySelectorAll('[role="menu"] [role="menuitem"]')].map(row=>row.textContent?.trim())).toEqual(['Add photos','Add file']);
  /* Escape is the menu's, not the page's. */
  await act(async()=>{host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(plus());
});

it('uploads a photo for a new chat under the ids the create will use, shows a chip, and sends it alone', async()=>{
  await mount(null);await flush();
  expect(send().disabled,'Send is pressable with nothing in the box').toBe(true);
  await pick('photos',[png()]);
  expect(uploadMessageAttachment,'the photo was not uploaded on pick').toHaveBeenCalledOnce();
  const upload=vi.mocked(uploadMessageAttachment).mock.calls[0]![0];
  expect(upload).toMatchObject({profile:'profile',type:'image',contentType:'image/png',name:'sky.png'});
  const draft=readConversationDrafts(scope,'new:general')[0]!.value;
  expect(upload.messageId,'the photo was staged under an id that is not the draft\'s').toBe(draft.id);
  expect(upload.conversationId,'a new chat\'s photo was staged under no chat id the draft keeps').toBe(draft.conversationId);
  expect(chips(),'no chip for the photo').toHaveLength(1);
  expect(chips()[0]!.className).toContain('chat-chip--ready');
  expect(draft.attachments?.map(item=>item.type),'the uploaded photo is not kept with the draft').toEqual(['image']);

  /* A PHOTO IS A MESSAGE: no words, and Send is pressable. */
  expect(send().disabled,'a photo-only message cannot be sent').toBe(false);
  await act(async()=>send().click());await flush();
  expect(createConversation).toHaveBeenCalledOnce();
  const [,conversationId,,,first]=vi.mocked(createConversation).mock.calls[0]!;
  expect(conversationId,'the chat was created under a different id than its photo was staged for').toBe(upload.conversationId);
  expect(first).toMatchObject({id:upload.messageId,content:'',attachmentIds:[draft.attachments![0]!.id]});
});

it('sends words and a file together in an existing chat, naming exactly the chips', async()=>{
  await mount();await flush();
  await type('Here is the lease.');
  await pick('file',[pdf()]);
  const upload=vi.mocked(uploadMessageAttachment).mock.calls[0]![0];
  expect(upload).toMatchObject({conversationId:chat,type:'file',contentType:'application/pdf',name:'Lease.pdf'});
  expect(chips()[0]!.textContent,'a file chip does not say its name').toContain('Lease.pdf');
  expect(chips()[0]!.querySelector('[data-home-action-icon="file"]'),'a file chip has no file glyph').toBeTruthy();
  expect(chips()[0]!.textContent,'a file chip does not say its size').toMatch(/\d+ KB/);
  const attached=readConversationDrafts(scope,chat)[0]!.value.attachments!;
  await act(async()=>send().click());await flush();
  expect(saveConversationMessage).toHaveBeenCalledOnce();
  const input=vi.mocked(saveConversationMessage).mock.calls[0]![2];
  expect(input).toMatchObject({id:upload.messageId,content:'Here is the lease.',attachmentIds:attached.map(item=>item.id)});
});

it('keeps the message id while it carries something, so words typed after a photo still send with it', async()=>{
  await mount();await flush();
  await pick('photos',[png()]);
  const upload=vi.mocked(uploadMessageAttachment).mock.calls[0]![0];
  await type('The sky tonight');
  expect(readConversationDrafts(scope,chat)[0]!.value.id,'typing forked the message away from its staged photo').toBe(upload.messageId);
  /* And a reload — a fresh writer, which forks a plain draft — keeps it too. */
  await act(async()=>root.unmount());root=createRoot(host);
  await mount();await flush();
  expect(chips(),'the chip did not survive a reload').toHaveLength(1);
  expect(fetchAttachmentUrl,'a restored photo chip did not ask for a look at its photo').toHaveBeenCalled();
  await type('The sky tonight, again');
  expect(readConversationDrafts(scope,chat)[0]!.value.id).toBe(upload.messageId);
});

it('takes a chip off the message on ×, and discards its upload at once', async()=>{
  vi.mocked(discardMessageAttachment).mockResolvedValue(undefined);
  await mount();await flush();
  await pick('photos',[png()]);
  expect(chips()).toHaveLength(1);
  const staged=readConversationDrafts(scope,chat)[0]!.value.attachments![0]!.id;
  await act(async()=>chips()[0]!.querySelector<HTMLButtonElement>('button[aria-label="Remove sky.png"]')!.click());
  expect(chips(),'× did not take the chip off').toHaveLength(0);
  expect(discardMessageAttachment,'× left the upload staged on the server').toHaveBeenCalledWith(staged,{profile:scope.profileId});
  expect(readConversationDrafts(scope,chat)[0]!.value.attachments,'the removed photo is still on the draft').toEqual([]);
  expect(send().disabled,'Send is pressable with nothing left in the box').toBe(true);
});

it('says a failed upload on its chip, holds Send, and retries on press', async()=>{
  vi.mocked(uploadMessageAttachment).mockRejectedValueOnce(new Error('network'));
  await mount();await flush();
  await type('with a photo');
  await pick('photos',[png()]);
  expect(chips()[0]!.className).toContain('chat-chip--failed');
  expect(chips()[0]!.textContent).toContain('Couldn’t add this');
  expect(send().disabled,'Send would drop a photo that never arrived').toBe(true);
  expect(send().title).toBe('Remove or retry the one that couldn’t be added');
  await act(async()=>chips()[0]!.querySelector<HTMLButtonElement>('button[aria-label="Try uploading sky.png again"]')!.click());await flush();
  expect(uploadMessageAttachment).toHaveBeenCalledTimes(2);
  expect(chips()[0]!.className).toContain('chat-chip--ready');
  expect(send().disabled).toBe(false);
});

it('refuses a file the server would refuse, in words, before uploading it', async()=>{
  await mount();await flush();
  await pick('file',[new File(['MZ'],'run.exe',{type:'application/x-msdownload'})]);
  expect(uploadMessageAttachment).not.toHaveBeenCalled();
  expect(host.querySelector('.chat-composer')!.textContent).toContain('This kind of file can’t be added');
  await pick('photos',[new File(['not a picture'],'fake.png',{type:'image/png'})]);
  expect(uploadMessageAttachment).not.toHaveBeenCalled();
  expect(chips()).toHaveLength(0);
  expect(host.querySelector('.chat-composer')!.textContent,'a photo that is not one was refused without a reason').toContain('Use a JPEG, PNG, WebP, GIF, AVIF or HEIC photo.');
});

it('takes six at most, says so, and dims the ＋ with the reason', async()=>{
  await mount();await flush();
  await pick('photos',Array.from({length:7},(_,at)=>png(`sky-${at}.png`)));
  expect(uploadMessageAttachment,'more than six were uploaded for one message').toHaveBeenCalledTimes(6);
  expect(chips()).toHaveLength(6);
  expect(host.textContent).toContain('Up to 6 at a time');
  expect(plus()!.disabled,'the ＋ still offers a seventh').toBe(true);
  expect(plus()!.title).toBe('Up to 6 at a time');
});

it('puts the mic and the ＋ into a slot the page lends, and not in the box', async()=>{
  class StubRecognition{start():void{}stop():void{}abort():void{}}
  (window as unknown as {SpeechRecognition?:unknown}).SpeechRecognition=StubRecognition;
  const slot=document.createElement('span');slot.id='lent-slot';document.body.append(slot);
  try{
    await mount(chat,'lent-slot');await flush();
    expect(plus(slot),'the ＋ did not go into the lent slot').toBeTruthy();
    expect(slot.querySelector('button.waka-dock-tool.chat-dictate'),'the mic did not go into the lent slot').toBeTruthy();
    expect(host.querySelector('footer.chat-composer button[aria-haspopup="menu"], footer.chat-composer .chat-dictate'),'the box kept them too').toBeNull();
    expect(host.querySelector('footer.chat-composer textarea'),'the box lost its field').toBeTruthy();
    expect(host.querySelector('footer.chat-composer button.chat-send'),'the box lost its Send').toBeTruthy();
  }finally{delete (window as unknown as {SpeechRecognition?:unknown}).SpeechRecognition;}
});
