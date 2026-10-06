/** WHAT THIS MOCKS, AND WHY: `fetch` supplies synthetic wire metadata. The real
 * owned client and decoder run; no UI, network provider or account is used. */
import {afterEach,expect,it,vi} from 'vitest';
import {fetchConversation,fetchConversationCitation,fetchConversationContext} from '../src/lib/api/conversations';
afterEach(()=>vi.unstubAllGlobals());
const reading={id:'reading',text:'I start with a small experiment.',truncated:false,supportCurrent:true};
function respond(body:unknown){const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status:200}));vi.stubGlobal('fetch',fetch);return fetch;}
it('accepts old undated current context and valid dated earlier context',async()=>{
  const fetch=respond({profileId:'profile',generationEnabled:true,principles:[],reading:[reading],inspirations:[]});
  expect((await fetchConversationContext('profile','conversation')).reading).toEqual([reading]);
  expect(fetch).toHaveBeenCalledWith('/api/conversations/conversation/context?profile=profile',expect.objectContaining({credentials:'include'}));
  respond({profileId:'profile',generationEnabled:true,principles:[],reading:[{...reading,historical:true,recordedAt:'2026-09-01T12:00:00Z'}],inspirations:[]});
  expect((await fetchConversationContext('profile','conversation')).reading[0].historical).toBe(true);
});
it.each([{historical:true},{historical:'yes',recordedAt:'2026-09-01'},{historical:true,recordedAt:'not a date'},{recordedAt:12}])('refuses malformed earlier metadata in context %#',metadata=>{
  respond({profileId:'profile',generationEnabled:true,principles:[],reading:[{...reading,...metadata}],inspirations:[]});
  return expect(fetchConversationContext('profile','conversation')).rejects.toMatchObject({code:'invalid_conversation'});
});
it('refuses an undated earlier citation and malformed metadata on a saved message',async()=>{
  respond({profileId:'profile',conversationId:'conversation',requestId:'request',index:0,source:{kind:'top_of_mind_entry',...reading,quote:'small experiment',historical:true}});
  await expect(fetchConversationCitation('profile','conversation','request',0)).rejects.toMatchObject({code:'invalid_conversation'});
  const createdAt='2026-10-01T12:00:00Z';
  respond({generationEnabled:true,conversation:{id:'conversation',profileId:'profile',revision:1,createdAt,updatedAt:createdAt,messages:[{id:'message',profileId:'profile',conversationId:'conversation',position:1,role:'assistant',content:'An earlier reading.',createdAt,citations:[{index:0,kind:'top_of_mind_entry',id:'reading',available:true,historical:true}]}]}});
  await expect(fetchConversation('profile','conversation')).rejects.toMatchObject({code:'invalid_conversation'});
});
