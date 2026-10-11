/** WHAT THIS MOCKS, AND WHY: `fetch` supplies synthetic wire metadata. The real
 * owned client and decoder run; no UI, network provider or account is used.
 *
 * WHAT IT COVERS NOW. Two thirds of this file read the two endpoints behind
 * the chat surface's "Your memory" sheet and its per-reply footnotes
 * (`fetchConversationContext`, `fetchConversationCitation`). Both surfaces and
 * both wrappers were deleted on 2026-10-10 when the conversation was cut back
 * to a transcript and a box — founder: "so many different buttons that I have
 * no idea what its supposed to do" — so the tests for them went with the code
 * they called, not with a feature that still exists untested.
 *
 * The rule they shared is still enforced here on the one reader that remains:
 * a record that CLAIMS to be from an earlier day and does not say which day
 * is refused rather than displayed undated. Saved messages still carry
 * citation metadata on the wire even though nothing renders it, so this is
 * still the decoder's live contract. */
import {afterEach,expect,it,vi} from 'vitest';
import {fetchConversation} from '../src/lib/api/conversations';
afterEach(()=>vi.unstubAllGlobals());
function respond(body:unknown){const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{status:200}));vi.stubGlobal('fetch',fetch);return fetch;}
it('refuses malformed earlier metadata on a saved message',async()=>{
  const createdAt='2026-10-01T12:00:00Z';
  respond({generationEnabled:true,conversation:{id:'conversation',profileId:'profile',revision:1,createdAt,updatedAt:createdAt,messages:[{id:'message',profileId:'profile',conversationId:'conversation',position:1,role:'assistant',content:'An earlier reading.',createdAt,citations:[{index:0,kind:'top_of_mind_entry',id:'reading',available:true,historical:true}]}]}});
  await expect(fetchConversation('profile','conversation')).rejects.toMatchObject({code:'invalid_conversation'});
  const fetched=respond({generationEnabled:true,conversation:{id:'conversation',profileId:'profile',revision:1,createdAt,updatedAt:createdAt,messages:[{id:'message',profileId:'profile',conversationId:'conversation',position:1,role:'assistant',content:'An earlier reading.',createdAt,citations:[{index:0,kind:'top_of_mind_entry',id:'reading',available:true,historical:true,recordedAt:'2026-09-01T12:00:00Z'}]}]}});
  expect((await fetchConversation('profile','conversation')).messages[0].citations?.[0].recordedAt).toBe('2026-09-01T12:00:00Z');
  expect(fetched).toHaveBeenCalledWith('/api/conversations/conversation?profile=profile&limit=30',expect.objectContaining({credentials:'include'}));
});
