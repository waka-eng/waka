// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api/conversations` returns committed records;
 * `lib/auth-context` supplies the owner. Real ChatPage, MemoryRouter, drafts,
 * URL transition and ConversationPanel render. Timers are faked for polling.
 * No server, provider or account data is used. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ChatPage from '../src/pages/Chat';
import {createConversation,fetchConversation,fetchConversationReply,listConversations,type ApiConversation} from '../src/lib/api/conversations';
const owner=vi.hoisted(()=>({account:'owner',profile:'profile'}));
vi.mock('../src/lib/auth-context',()=>({useAuth:()=>({status:'authenticated',account:{id:owner.account},profile:{id:owner.profile,preferredLocale:'en-US'}})}));
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),listConversations:vi.fn()}));
let host:HTMLDivElement,root:Root,row:ApiConversation|null;
const render=()=>act(async()=>root.render(<MemoryRouter initialEntries={['/chat/new']}><Routes><Route path="/chat/:conversationId" element={<ChatPage/>}/></Routes></MemoryRouter>));
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});localStorage.clear();sessionStorage.clear();owner.account='owner';owner.profile='profile';row=null;
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  vi.mocked(listConversations).mockImplementation(async profile=>({profileId:profile,conversations:[],generationEnabled:true}));
  vi.mocked(createConversation).mockImplementation(async(profile,id,_signal,_principle,first)=>{
    row={id,profileId:profile,revision:1,generationEnabled:true,createdAt:'2026-10-05T00:00:00Z',updatedAt:'2026-10-05T00:00:00Z',messages:[{id:first!.id,profileId:profile,conversationId:id,position:1,role:'user',content:first!.content,createdAt:'2026-10-05T00:00:00Z'}]};return structuredClone(row);
  });
  vi.mocked(fetchConversation).mockRejectedValue(new Error('No bootstrap reread or foreign conversation'));
  vi.mocked(fetchConversationReply).mockImplementation(async(profile,id)=>({profileId:profile,conversationId:id,revision:1,messageId:row!.messages[0].id,requestId:'11111111-1111-4111-8111-111111111111',phase:'pending',canRetry:false,retryAfter:null,runAfter:null,failureCode:null,generationEnabled:true}));
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
/* THE FIRST QUESTION IS TYPED NOW, NOT PICKED. Both tests here used to press
   a starter pill — one of three buttons on the empty screen that SENT a
   message on a single press. They are gone (see `ConversationPanel`'s
   header), so the first question arrives the way every other one does: typed
   into the box, sent with the box's own button. Nothing else about what these
   two protect has changed. */
const send=()=>act(async()=>host.querySelector<HTMLButtonElement>('.chat-send')!.click());
const ask=async(words:string)=>{
  await act(async()=>{const area=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,words);area.dispatchEvent(new Event('input',{bubbles:true}));});
  await send();
};
it('retains the confirmed first question through the real new-to-id route without another GET',async()=>{
  await render();await ask('What has changed in how I think?');
  expect(createConversation).toHaveBeenCalledOnce();expect(fetchConversation).not.toHaveBeenCalled();
  expect(host.querySelector('.chat-messages > li[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
  expect(host.textContent).toContain('Thinking about that…');expect(host.textContent).not.toContain('This conversation couldn’t be opened.');
  /* STARTING OVER MOVED TO THE CORNER, which this harness does not mount —
     it renders the panel alone, so there is no "New conversation" button
     here to press. What the test was really protecting is above and
     unchanged: the committed first question survives the new-to-id route
     without a second GET. */
});
it('clears the bootstrap on a profile switch instead of showing another owner’s committed question',async()=>{
  await render();await ask('What has changed in how I think?');
  owner.account='other-owner';owner.profile='other-profile';await render();
  expect(fetchConversation).toHaveBeenCalledWith('other-profile',row!.id,expect.any(AbortSignal));
  expect(host.querySelector('.chat-messages')?.textContent).not.toContain('What has changed in how I think?');
});
