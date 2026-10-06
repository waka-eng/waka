/** WHAT THIS MOCKS, AND WHY: `fetch` supplies contiguous/malformed wire
 * windows. The real client preserves total revisions and request scope. */
import {afterEach,expect,it,vi} from 'vitest';
import {fetchConversation,saveConversationMessage} from '../src/lib/api/conversations';
afterEach(()=>vi.unstubAllGlobals());
const createdAt='2026-10-05T12:00:00Z';
const row={id:'conversation',profileId:'profile',revision:40,createdAt,updatedAt:createdAt,messageWindowStart:11,
  messages:Array.from({length:30},(_,i)=>({id:`message-${i+11}`,profileId:'profile',conversationId:'conversation',position:i+11,role:'user',content:'Synthetic words.',createdAt}))};
it('requests a bounded first window and accepts complete tail positions',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({conversation:row,generationEnabled:false})));vi.stubGlobal('fetch',fetch);
  expect((await fetchConversation('profile','conversation')).messages).toHaveLength(30);
  expect(fetch).toHaveBeenCalledWith('/api/conversations/conversation?profile=profile&limit=30',expect.objectContaining({credentials:'include'}));
});
it('requests the earlier loaded span explicitly',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({conversation:row,generationEnabled:false})));vi.stubGlobal('fetch',fetch);
  await fetchConversation('profile','conversation',undefined,11);
  expect(fetch.mock.calls[0][0]).toBe('/api/conversations/conversation?profile=profile&from=11');
});
it.each([{messageWindowStart:0},{messageWindowStart:null},{messageWindowStart:12},{revision:41}])('refuses malformed range or missing positions %#',async override=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({conversation:{...row,...override},generationEnabled:false}))));
  await expect(fetchConversation('profile','conversation')).rejects.toMatchObject({code:'invalid_conversation'});
});
it('falls back only for an older server query refusal, keeping durable write identity',async()=>{
  const legacy={...row,revision:1,messageWindowStart:undefined,messages:[{...row.messages[0],position:1}]};
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:'Invalid profile'}),{status:400})).mockResolvedValueOnce(new Response(JSON.stringify({conversation:legacy,generationEnabled:false})));vi.stubGlobal('fetch',fetch);
  const input={id:'durable-message',content:'Owned words.',revision:0};await saveConversationMessage('profile','conversation',input);
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toBe('/api/conversations/conversation/messages?profile=profile');
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
});
it('does not replay ambiguous or actual window failures',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'Invalid message window.'}),{status:400}));vi.stubGlobal('fetch',fetch);
  await expect(saveConversationMessage('profile','conversation',{id:'durable',content:'Owned words.',revision:0})).rejects.toThrow();expect(fetch).toHaveBeenCalledOnce();
});
