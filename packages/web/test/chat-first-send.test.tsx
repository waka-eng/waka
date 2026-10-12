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
it('retains the confirmed first question through the real new-to-id route without another GET',async()=>{
  await render();await ask('What has changed in how I think?');
  expect(createConversation).toHaveBeenCalledOnce();expect(fetchConversation).not.toHaveBeenCalled();
  expect(host.querySelector('.chat-message[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
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
