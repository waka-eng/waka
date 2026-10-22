// @vitest-environment jsdom
/**
 * A SENT MESSAGE NEVER COMES BACK ON THE NEXT MOUNT (L10).
 *
 * Every mount is a new draft writer, so the first edit after a reload,
 * reopening or switching back forks the restored draft O into F. Sending F
 * used to clear F alone, and O — words already sent — came back in the box:
 * in that chat, or for a new chat in the NEXT new chat. This tab now records
 * each fork (`lib/draft-lineage.ts`) and a confirmed send clears the line.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/conversations` returns
 * committed records the way `chat-composer-attachments.test.tsx` does, and
 * `lib/api/attachments` stands in for the upload. The real panel, the real
 * draft storage and the real per-tab lineage run.
 */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {createConversation,fetchConversation,fetchConversationReply,listConversations,saveConversationMessage,type ApiConversation} from '../src/lib/api/conversations';
import {fetchAttachmentUrl,uploadMessageAttachment,type ApiMessageAttachment} from '../src/lib/api/attachments';
import {readConversationDrafts,storeConversationDraft} from '../src/lib/conversation-drafts';
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),listConversations:vi.fn(),saveConversationMessage:vi.fn()}));
vi.mock('../src/lib/api/attachments',async original=>({...await original<typeof import('../src/lib/api/attachments')>(),uploadMessageAttachment:vi.fn(),fetchAttachmentUrl:vi.fn(),discardMessageAttachment:vi.fn()}));

const scope={accountId:'owner',profileId:'profile'},chat='11111111-1111-4111-8111-111111111111',otherChat='99999999-9999-4999-8999-999999999999',choose=vi.fn();
let root:Root,host:HTMLDivElement,stored:ApiConversation;
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  stored={id:chat,profileId:scope.profileId,revision:0,createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z',messages:[]};
  vi.mocked(fetchConversation).mockImplementation(async()=>structuredClone(stored));
  vi.mocked(listConversations).mockResolvedValue({profileId:scope.profileId,conversations:[],generationEnabled:false});
  vi.mocked(fetchConversationReply).mockResolvedValue({profileId:scope.profileId,conversationId:chat,messageId:null,requestId:null,phase:'idle',revision:0,failureCode:null,retryAfter:null,runAfter:null,canRetry:false,generationEnabled:false});
  const sent=(conversationId:string,input:{id:string;content:string})=>{
    stored={...stored,id:conversationId,revision:stored.revision+1,messages:[...stored.messages,{id:input.id,content:input.content,profileId:scope.profileId,conversationId,position:stored.revision+1,role:'user',createdAt:'2026-10-21T01:00:00Z',attachments:[]}]};
    return structuredClone(stored);
  };
  vi.mocked(saveConversationMessage).mockImplementation(async(_profile,conversationId,input)=>sent(conversationId,input));
  vi.mocked(createConversation).mockImplementation(async(_profile,conversationId,_signal,_principle,first)=>sent(conversationId,first!));
  vi.mocked(uploadMessageAttachment).mockImplementation(async(input)=>({id:crypto.randomUUID(),conversationId:input.conversationId,messageId:input.messageId,staged:true,
    type:input.type,name:input.name??null,contentType:input.contentType,size:input.file.size,createdAt:'2026-10-21T00:30:00Z'} satisfies ApiMessageAttachment));
  vi.mocked(fetchAttachmentUrl).mockResolvedValue('https://bucket.test/read');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});

const flush=()=>act(async()=>{for(let turn=0;turn<6;turn+=1)await Promise.resolve();});
const mount=async(id:string|null=chat)=>{await act(async()=>root.render(<ConversationPanel key={String(id)} scope={scope} id={id} locale="en-US" onChoose={choose}/>));await flush();};
/** A new mount in the same tab: a reload, reopening the chat, or coming back to it. */
const remount=async(id:string|null=chat)=>{await act(async()=>root.unmount());root=createRoot(host);await mount(id);};
const box=()=>host.querySelector('textarea')!;
const type=(content:string)=>act(async()=>{const area=box();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,content);area.dispatchEvent(new Event('input',{bubbles:true}));});
const send=async()=>{await act(async()=>host.querySelector<HTMLButtonElement>('button.chat-send')!.click());await flush();};
const png=()=>new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82])],'sky.png',{type:'image/png'});
async function pickPhoto(){
  const input=[...host.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(node=>!node.accept.includes('application/pdf'))!;
  Object.defineProperty(input,'files',{configurable:true,value:[png()]});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});await flush();
}

it('clears the restored draft with its sent fork, so a reopened chat is empty',async()=>{
  await mount();await type('Original words');await remount();
  expect(box().value).toBe('Original words');
  await type('Original words, and more');
  expect(readConversationDrafts(scope,chat),'the edit did not fork').toHaveLength(2);
  await send();
  expect(saveConversationMessage).toHaveBeenCalledOnce();
  expect(readConversationDrafts(scope,chat),'the restored draft outlived the send').toEqual([]);
  await remount();expect(box().value).toBe('');
});

it('does not bring a sent first message back in the NEXT new chat',async()=>{
  await mount(null);await type('First words');await remount(null);
  await type('First words, edited');await send();
  expect(createConversation).toHaveBeenCalledOnce();expect(choose).toHaveBeenCalledOnce();
  expect(readConversationDrafts(scope,'new:general'),'the original draft waits for the next new chat').toEqual([]);
  await remount(null);expect(box().value).toBe('');
});

it('clears a whole chain of forks made across several mounts',async()=>{
  await mount();await type('One');await remount();await type('One two');await remount();await type('One two three');
  expect(readConversationDrafts(scope,chat)).toHaveLength(3);
  await send();
  expect(readConversationDrafts(scope,chat),'the first of the chain came back').toEqual([]);
});

it('clears the restored draft even when its words were changed before sending',async()=>{
  await mount();await type('Words I will take back');await remount();
  await type('Something else entirely');await send();
  expect(vi.mocked(saveConversationMessage).mock.calls[0]![2].content).toBe('Something else entirely');
  expect(readConversationDrafts(scope,chat)).toEqual([]);
});

it('clears the restored draft when attaching the first photo forked it, with no typing',async()=>{
  await mount();await type('Look at this');await remount();
  await pickPhoto();
  expect(uploadMessageAttachment).toHaveBeenCalledOnce();
  expect(readConversationDrafts(scope,chat),'attaching did not fork the restored draft').toHaveLength(2);
  await send();
  expect(readConversationDrafts(scope,chat),'the draft from before the photo came back').toEqual([]);
});

it('never clears another tab’s draft that this tab did not fork from',async()=>{
  await mount();await type('Mine');
  /* Meanwhile another tab keeps its own drafts, here and in another chat,
     older than ours so the next mount restores ours. */
  const otherWriter='6c1d0e9f-8a7b-4c6d-8e9f-0a1b2c3d4e5f';
  storeConversationDraft(scope,chat,{id:'5b0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e',writer:otherWriter,updatedAt:1,content:'Another tab, still typing',revision:0,pending:false});
  storeConversationDraft(scope,otherChat,{id:'4a0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e',writer:otherWriter,updatedAt:1,content:'Another chat',revision:0,pending:false});
  await remount();expect(box().value).toBe('Mine');
  await type('Mine, edited');await send();
  expect(readConversationDrafts(scope,chat).map(row=>row.value.content)).toEqual(['Another tab, still typing']);
  expect(readConversationDrafts(scope,otherChat).map(row=>row.value.content)).toEqual(['Another chat']);
});

it('never deletes another open tab’s idle draft that this tab restored, forked and sent',async()=>{
  /* Tab B wrote this draft and is still showing it, untouched. Tab A (this
     panel) restores it as the newest, forks it on its first edit and sends. */
  const theirs={id:'3d0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e',writer:'6c1d0e9f-8a7b-4c6d-8e9f-0a1b2c3d4e5f',updatedAt:1,content:'Tab B, idle',revision:0,pending:false};
  storeConversationDraft(scope,chat,theirs);
  await mount();expect(box().value).toBe('Tab B, idle');
  await type('Tab B, idle, and what tab A added');await send();
  expect(saveConversationMessage).toHaveBeenCalledOnce();
  expect(readConversationDrafts(scope,chat).map(row=>row.value),'a send in tab A deleted the draft tab B still shows').toEqual([theirs]);
});

it('never deletes words another tab wrote under a key this tab made, when this tab then forks and sends',async()=>{
  /* Tab A (this panel) writes K with a photo. Tab B carries K (a draft with
     photos keeps its key), takes the photo off and writes its own words. */
  await mount();await pickPhoto();
  const mine=readConversationDrafts(scope,chat)[0]!;
  const theirs={...mine.value,writer:'6c1d0e9f-8a7b-4c6d-8e9f-0a1b2c3d4e5f',updatedAt:Date.now()+1000,content:'Tab B words'};delete theirs.attachments;
  localStorage.setItem(mine.key,JSON.stringify(theirs));
  /* A reloads, restores K as tab B left it, forks it on an edit and sends. */
  await remount();expect(box().value).toBe('Tab B words');
  await type('Tab B words, and what tab A added');await send();
  expect(saveConversationMessage).toHaveBeenCalledOnce();
  expect(readConversationDrafts(scope,chat).map(row=>row.value),'a send in tab A deleted tab B\u2019s words').toEqual([theirs]);
});
