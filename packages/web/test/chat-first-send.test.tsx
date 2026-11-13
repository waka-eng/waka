// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api/conversations` returns committed records;
 * `lib/auth-context` supplies the owner. The real `ConversationPanel`,
 * MemoryRouter, drafts and new-to-id URL transition render; the few lines of
 * the world that hold the committed row are reproduced here as `TalkHost`
 * (see its note). Timers are faked for polling. No server, provider or
 * account data is used. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,Route,Routes,useNavigate,useParams} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useAuth} from '../src/lib/auth-context';
import {useRef} from 'react';
import {ConversationPanel} from '../src/components/ConversationPanel';
import {ApiError} from '../src/lib/api';
import {storeConversationDraft} from '../src/lib/conversation-drafts';
import {createConversation,fetchConversation,fetchConversationReply,listConversations,type ApiConversation} from '../src/lib/api/conversations';
const owner=vi.hoisted(()=>({account:'owner',profile:'profile'}));
vi.mock('../src/lib/auth-context',()=>({useAuth:()=>({status:'authenticated',account:{id:owner.account},profile:{id:owner.profile,preferredLocale:'en-US'}})}));
vi.mock('../src/lib/api/conversations',async original=>({...await original<typeof import('../src/lib/api/conversations')>(),createConversation:vi.fn(),fetchConversation:vi.fn(),fetchConversationReply:vi.fn(),listConversations:vi.fn()}));
let host:HTMLDivElement,root:Root,row:ApiConversation|null;
/**
 * THE FEW LINES OF THE WORLD THAT HOLD A COMMITTED ROW.
 *
 * `pages/Chat` is gone. Founder: "also dont move talk to waka in a new page.
 * find better transition." A conversation was the last surface that replaced
 * the world, so it is an overlay now and the memory that used to live on the
 * chat page lives in `pages/Home` as `committedTalk`.
 *
 * Mounting the whole world to exercise two lines of it would make this suite
 * depend on the canvas, the camera and the three layers — none of which has
 * anything to do with what it protects. So the ownership rule is reproduced
 * here, deliberately and visibly: hold the row `createConversation` returned,
 * and drop it the moment the owner or the conversation changes.
 *
 * WHAT IS REAL IS THE PART THAT MATTERS. `ConversationPanel` decides for
 * itself whether a handed-down row may be believed — it requires the id AND
 * the profile to match before using it instead of fetching — and that guard
 * is the thing a second owner's question would have to get past. This host
 * only feeds it; the panel under test is the production one.
 */
function TalkHost(){
  const auth=useAuth(),go=useNavigate();
  const id=useParams().conversationId==='new'?null:useParams().conversationId??null;
  const scope={accountId:auth.account!.id,profileId:auth.profile!.id};
  const owner=`${scope.accountId}:${scope.profileId}`;
  const committed=useRef<{owner:string;row:ApiConversation}|null>(null);
  if(committed.current&&(committed.current.owner!==owner||committed.current.row.id!==id))committed.current=null;
  return <ConversationPanel key={`${owner}:${id??'new'}`} scope={scope} id={id} locale="en-US"
    initialConversation={committed.current?.row}
    onCreated={row=>{if(row.profileId===scope.profileId)committed.current={owner,row};}}
    /* THE NEW-TO-ID HOP, which is the whole point of the first case: a
       conversation is created, the address stops saying "new" and starts
       naming the row, and the question already on screen must survive that
       without being re-fetched. `replace` so dismissing the overlay does not
       land back on the blank conversation. The world does the same thing
       through its own history writer. */
    onChoose={next=>{if(next!==id)go(`/chat/${next??'new'}`,{replace:!id&&Boolean(next)});}}/>;
}
const render=()=>act(async()=>root.render(<MemoryRouter initialEntries={['/chat/new']}><Routes><Route path="/chat/:conversationId" element={<TalkHost/>}/></Routes></MemoryRouter>));
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
it('clears the first-message editor before a slow server confirms, showing the words only in the thread', async()=>{
  const actual=vi.mocked(createConversation).getMockImplementation()!;
  let finish!:()=>void;
  vi.mocked(createConversation).mockImplementationOnce(async(...args)=>{
    await new Promise<void>(resolve=>{finish=resolve;});return actual(...args);
  });
  await render();await ask('A slow first message');
  expect(host.querySelector('textarea')!.value).toBe('');
  expect(host.querySelectorAll('.chat-message')).toHaveLength(1);
  expect(host.querySelector('.chat-sending')?.textContent).toContain('A slow first message');
  expect(host.textContent).toContain('Sending…');
  await act(async()=>finish());
  expect(host.querySelectorAll('.chat-message')).toHaveLength(1);
  expect(host.querySelector('textarea')!.value).toBe('');
});
it('retains the confirmed first question through the real new-to-id route without another GET',async()=>{
  await render();await ask('What has changed in how I think?');
  expect(createConversation).toHaveBeenCalledOnce();expect(fetchConversation).not.toHaveBeenCalled();
  expect(host.querySelector('.chat-message[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
  expect(host.textContent).toContain('Thinking…');expect(host.textContent).not.toContain('Couldn’t open this chat.');
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

it('shows one WAKA opening and starts conversations on personal memory', async()=>{
  await render();
  expect(host.querySelector('.chat-with')).toBeNull();
  expect(host.textContent).not.toContain('Demo Agent');
  await ask('What should I think about?');
  expect(vi.mocked(createConversation).mock.calls[0]![5]).toBeUndefined();
});

it('asks nobody to choose when there is no agent, and starts an ordinary chat', async()=>{
  await render();
  expect(host.querySelector('.chat-with')).toBeNull();
  await ask('Just me');
  expect(vi.mocked(createConversation).mock.calls[0]![5]).toBeUndefined();
});

/* A recovered pre-flight read keeps the original press and clears its stale notice. */
it('sends after a failed pre-flight read recovers and drops the stale notice', async()=>{
  vi.mocked(listConversations).mockRejectedValueOnce(new Error('Offline'));
  await render();
  expect(host.textContent).toContain('WAKA can’t be reached right now.');
  let answer!:(value:Awaited<ReturnType<typeof listConversations>>)=>void;
  vi.mocked(listConversations).mockImplementationOnce(()=>new Promise(resolve=>{answer=resolve;}));
  await ask('Just me');                                         // pre-flight in flight
  await render();
  await act(async()=>{answer({profileId:'profile',conversations:[],generationEnabled:true});});
  expect(createConversation).toHaveBeenCalledOnce();
  expect(vi.mocked(createConversation).mock.calls[0]![5]).toBeUndefined();
  expect(host.textContent).not.toContain('WAKA can’t be reached right now.');
});

it('preserves an unsent older draft’s words while starting only on personal memory', async()=>{
  storeConversationDraft({accountId:'owner',profileId:'profile'},'new:general',{id:'5b0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e',writer:'6c1d0e9f-8a7b-4c6d-8e9f-0a1b2c3d4e5f',updatedAt:1,content:'What do we each think?',revision:0,pending:false,talkWith:'both'});
  await render();
  expect(host.querySelector('textarea')!.value).toBe('What do we each think?');
  await send();
  expect(createConversation).toHaveBeenCalledOnce();
  expect(vi.mocked(createConversation).mock.calls[0]![5]).toBeUndefined();
});

const pendingChat='77777777-7777-4777-8777-777777777777',pendingMessage='88888888-8888-4888-8888-888888888888',legacyAgent='99999999-9999-4999-8999-999999999999';
function legacyPending(){storeConversationDraft({accountId:'owner',profileId:'profile'},'new:general',{id:pendingMessage,writer:'66666666-6666-4666-8666-666666666666',conversationId:pendingChat,updatedAt:1,content:'My retained words',revision:0,pending:true,talkWith:'both',agentId:legacyAgent,attachments:[{id:'55555555-5555-4555-8555-555555555555',type:'image',name:'kept.png',contentType:'image/png',size:42}]});}
it('reconciles a committed legacy first send without duplicating or rebinding it',async()=>{
 legacyPending();
 vi.mocked(fetchConversation).mockImplementation(async()=>({id:pendingChat,profileId:'profile',revision:1,perspective:'both',agentProfileId:legacyAgent,generationEnabled:false,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',messages:[{id:pendingMessage,profileId:'profile',conversationId:pendingChat,position:1,role:'user',content:'My retained words',createdAt:'2026-10-01T00:00:00Z'}]}));
 await render();await send();expect(createConversation).not.toHaveBeenCalled();expect(host.textContent).toContain('My retained words');expect(host.textContent,'a chat on both memories is not the agent’s alone').not.toContain('Answers from your agent’s memory.');
});
it('recovers a never-committed legacy send after 404 with the same message and attachment IDs',async()=>{
 legacyPending();vi.mocked(fetchConversation).mockRejectedValue(new ApiError({status:404,code:'not_found',message:'Missing'}));
 await render();await send();expect(createConversation).toHaveBeenCalledOnce();const args=vi.mocked(createConversation).mock.calls[0]!;expect(args[1]).toBe(pendingChat);expect(args[4]).toMatchObject({id:pendingMessage,content:'My retained words',attachmentIds:['55555555-5555-4555-8555-555555555555']});expect(args[5]).toBeUndefined();
});
it('retains the exact legacy journal if a 404 races a late commit, then reconciles it on retry',async()=>{
 legacyPending();vi.mocked(fetchConversation).mockRejectedValue(new ApiError({status:404,code:'not_found',message:'Missing'}));vi.mocked(createConversation).mockRejectedValueOnce(new ApiError({status:409,code:'conversation_conflict',message:'Already created'}));
 await render();await send();const saved=Object.keys(localStorage).map(key=>localStorage.getItem(key)??'').find(text=>text.includes(pendingMessage));expect(saved).toContain(legacyAgent);expect(saved).toContain('kept.png');
 vi.mocked(fetchConversation).mockResolvedValue({id:pendingChat,profileId:'profile',revision:1,perspective:'both',agentProfileId:legacyAgent,generationEnabled:false,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',messages:[{id:pendingMessage,profileId:'profile',conversationId:pendingChat,position:1,role:'user',content:'My retained words',createdAt:'2026-10-01T00:00:00Z'}]});
 await send();expect(createConversation).toHaveBeenCalledOnce();expect(host.textContent,'a chat on both memories is not the agent’s alone').not.toContain('Answers from your agent’s memory.');
});
