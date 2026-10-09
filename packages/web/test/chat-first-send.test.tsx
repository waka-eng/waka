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
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(row=>row.textContent===label)!;
it('retains the confirmed first question through the real new-to-id route without another GET',async()=>{
  await render();await act(async()=>button('What has changed in how I think?').click());
  expect(createConversation).toHaveBeenCalledOnce();expect(fetchConversation).not.toHaveBeenCalled();
  expect(host.querySelector('.chat-messages > li[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
  expect(host.textContent).toContain('Waiting to start…');expect(host.textContent).not.toContain('This conversation couldn’t be opened.');
  /* Starting over is in the conversations sheet now, not a standing column. */
  await act(async()=>button('All conversations').click());await act(async()=>button('New conversation').click());expect(host.querySelectorAll('.chat-messages > li')).toHaveLength(0);
});
it('clears the bootstrap on a profile switch instead of showing another owner’s committed question',async()=>{
  await render();await act(async()=>button('What has changed in how I think?').click());
  owner.account='other-owner';owner.profile='other-profile';await render();
  expect(fetchConversation).toHaveBeenCalledWith('other-profile',row!.id,expect.any(AbortSignal));
  expect(host.querySelector('.chat-messages')?.textContent).not.toContain('What has changed in how I think?');
});
